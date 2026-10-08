"""Export a saved bot's actor to ONNX for the browser, and check it against PyTorch.

    venv\\Scripts\\python.exe web\\tools\\export_onnx.py runs/clone_generalist web\\site\\bots\\clone_generalist.onnx

The ONNX graph takes the observation pieces exactly as RoyaleLearn's EvalActors.obs_batch builds
them for a batch of one (frame stack 1) and returns the raw logits over the action space. Masking
and sampling are done in JS, as MaskedCategorical + decode_actions("stochastic") do here.
"""
import json
import sys
from pathlib import Path

import msgspec
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from common import build_env  # noqa: E402
from royalelearn import config as cfg  # noqa: E402
from royalelearn.api.policy import ObsBatch  # noqa: E402
from royalelearn.api.rollout import EnvSpec  # noqa: E402
from royalelearn.ladder.actors import EvalActors  # noqa: E402
from royalelearn.ladder.snapshots import _decode_tensors  # noqa: E402
from royalelearn.learn.actor_critic import ClashActor  # noqa: E402
from royalelearn.learn.nets import ClashTrunk, build_policy_head, resolve_dtype  # noqa: E402
from royalelearn.learner import _bot_files  # noqa: E402


def load_actor(path: Path):
    record_file, weights = _bot_files(path)
    record = msgspec.json.decode(record_file.read_bytes())
    spec = msgspec.convert(record["env_spec"], EnvSpec)
    net = msgspec.convert(record["net"], cfg.NetConfig)
    actor = ClashActor(ClashTrunk(spec, net), build_policy_head(spec, net), resolve_dtype(net.autocast_dtype))
    state = _decode_tensors(weights.read_bytes(), "cpu")
    if state and all(k.startswith("actor.") for k in state):
        state = {k.removeprefix("actor."): v for k, v in state.items()}
    actor.load_state_dict(state)
    actor.eval()
    return actor, spec, net


class Wrapped(torch.nn.Module):
    def __init__(self, actor, with_ids: bool):
        super().__init__()
        self.actor = actor
        self.with_ids = with_ids

    def forward(self, spatial, mask_planes, vector, card_ids=None):
        # The logits do not read the mask (it is applied after, in JS), so it is not an input.
        batch = ObsBatch(spatial=spatial, mask_planes=mask_planes, vector=vector, mask=None,
                         card_ids=card_ids if self.with_ids else None)
        return self.actor.logits(batch).float()


def sample_obs(n_steps=60, seed=3):
    """Real observations from a battle between two random players."""
    env = build_env()
    rng = np.random.default_rng(seed)
    obs, _ = env.reset(seed=seed)
    out = []
    for _ in range(n_steps):
        out.append(obs["blue"])
        acts = {}
        for a in env.agents:
            legal = np.flatnonzero(obs[a]["action_mask"])
            acts[a] = int(rng.choice(legal)) if rng.random() < 0.3 else 0
        obs, *_ = env.step(acts)
        if not env.agents:
            break
    return out


def main():
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    actor, spec, net = load_actor(ROOT / src)
    ev = EvalActors(spec, net, None, release_mode="stochastic")
    assert spec.frame_stack == 1, "the web build assumes no frame stacking"
    obs_list = sample_obs()
    b0 = ev.obs_batch(obs_list[0], None)
    with_ids = b0.card_ids is not None
    assert b0.unit_ids is None, "unit identity planes are not handled"
    model = Wrapped(actor, with_ids)
    names = ["spatial", "mask_planes", "vector"] + (["card_ids"] if with_ids else [])
    args = tuple(getattr(b0, n) for n in names)
    dst.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(model, args, str(dst), input_names=names, output_names=["logits"], opset_version=17,
                      dynamo=False)

    import onnxruntime as ort
    sess = ort.InferenceSession(str(dst), providers=["CPUExecutionProvider"])
    worst = 0.0
    for o in obs_list:
        b = ev.obs_batch(o, None)
        feed = {n: getattr(b, n).numpy() for n in names}
        ref = model(*[getattr(b, n) for n in names]).detach().numpy()
        got = sess.run(None, feed)[0]
        legal = b.mask.numpy()[0]
        worst = max(worst, float(np.abs(ref[0][legal] - got[0][legal]).max()))
    print(f"exported {dst} ({dst.stat().st_size / 1e6:.1f} MB); max |logit diff| on legal moves over "
          f"{len(obs_list)} real observations: {worst:.2e}")
    meta = {"inputs": {n: list(getattr(b0, n).shape) for n in names},
            "dtypes": {n: str(getattr(b0, n).dtype).replace("torch.", "") for n in names},
            "source": str(src).replace("\\", "/")}
    dst.with_suffix(".json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
