"""The battle, run inside Pyodide: the real RoyaleSim engine (compiled to WebAssembly) and the
unchanged royalegym environment, so the bot sees exactly what it saw in training.

JS drives it: reset(seed) -> frames, then step(blue_action, red_action) once per decision
(500 ms of game time = 10 ticks). The bot's network runs in JS (onnxruntime-web) on the
arrays bot_inputs() returns.
"""
import base64
import json
import sys
import types

# Pyodide has no _multiprocessing (no processes in a browser). gymnasium imports it at import time
# for AsyncVectorEnv, which nothing here uses: a stand-in lets the import through.
if sys.platform == "emscripten" and "_multiprocessing" not in sys.modules:
    _mp = types.ModuleType("_multiprocessing")

    class _SemLock:
        SEM_VALUE_MAX = 2**31 - 1

        def __init__(self, *a, **k):
            raise OSError("no multiprocessing in the browser")

    _mp.SemLock = _SemLock
    _mp.sem_unlink = lambda *a: None
    _mp.flags = {}
    sys.modules["_multiprocessing"] = _mp

import numpy as np  # noqa: E402
from royalegym import CombinedReward, CrownReward, TowerHPReward, WinLossReward, make_env  # noqa: E402
from royalegym.replay import ReplayRecorder  # noqa: E402

# The deck and reward of the project's common.build_env (the reward does not change play).
HOG_2_6 = ["HogRider", "Musketeer", "Cannon", "IceGolemite", "IceSpirits", "Skeletons", "Fireball", "Log"]


def build_env():
    reward = CombinedReward([(WinLossReward(), 1.0), (CrownReward(), 0.2), (TowerHPReward(), 0.1)])
    return make_env(reward=reward, deck=HOG_2_6)


def _t(v, sub):
    return round(v / sub, 2)


class Game:
    def __init__(self):
        self.env = build_env()
        self.engine = self.env.engine
        a = self.engine.arena()
        self.sub, self.nx, self.ny = a.subtile, a.tiles_x, a.tiles_y
        self.cards = {c.card_id: c for c in self.engine.cards()}
        self.out = []
        game = self

        class Live(ReplayRecorder):
            def begin(self, engine, seed, init):
                super().begin(engine, seed, init)
                game.out.append(("frame", game.frame()))

            def record_frame(self, engine):
                super().record_frame(engine)
                game.out.append(("frame", game.frame()))

            def record_step(self, tick, ticks, commands, results):
                super().record_step(tick, ticks, commands, results)
                for r in results:
                    c = game.cards.get(r.card_id)
                    game.out.append(("play", {"team": r.team, "card": r.card_id, "name": c.name if c else "?",
                                              "ok": r.status == 0, "status": r.status, "tick": r.tick,
                                              "x": _t(r.x, game.sub), "y": _t(r.y, game.sub)}))

        self.rec = Live(frame_every_tick=True)
        self.env.recorder = self.rec
        self.obs = None
        self.rng = None

    # ------------------------------------------------------------- static data
    def meta(self):
        a = self.engine.arena()
        self.obs, _ = self.env.reset(seed=0)  # the engine has no state to read before a reset
        self.out = []
        s = self.engine.state()
        return json.dumps({
            "tiles_x": a.tiles_x, "tiles_y": a.tiles_y,
            "water_half_rows": list(a.water_half_rows), "bridges_half_cols": [list(b) for b in a.bridges_half_cols],
            "tick_ms": s.tick_ms, "decision_ms": self.env.decision_ms,
            "cards": {c.card_id: {"name": c.name, "elixir": c.elixir, "placement": c.placement,
                                  "radius": round(c.radius / a.subtile, 2), "flying": c.flying}
                      for c in self.engine.cards()},
        })

    def frame(self):
        s = self.engine.state()
        sub = self.sub
        reg = s.regular_ticks
        left = (reg - s.tick) if s.tick < reg else (reg + s.overtime_ticks - s.tick)
        me, bot = s.players[0], s.players[1]
        return {
            "t": s.tick, "left": max(0, left) * s.tick_ms / 1000, "ot": bool(s.overtime), "rate": s.elixir_rate,
            "e": [[e.uid, e.team, e.kind, e.card_id, e.tower_slot, _t(e.x, sub), _t(e.y, sub), e.hp, e.max_hp,
                   _t(e.radius, sub), int(e.flying), e.deploy_ticks, e.stun_ticks, e.shield] for e in s.entities],
            "sp": [[p.team, p.card_id, p.motion, _t(p.x, sub), _t(p.y, sub), _t(p.aim_x, sub), _t(p.aim_y, sub),
                    p.travelled, p.length] for p in s.spells],
            "pr": [[p.team, _t(p.x, sub), _t(p.y, sub), _t(p.aim_x, sub), _t(p.aim_y, sub), _t(p.splash, sub)]
                   for p in s.projectiles],
            "crowns": [me.crowns, bot.crowns], "elixir": [me.elixir_milli / 1000, bot.elixir_milli / 1000],
            "hand": list(me.hand), "next": me.next_card, "kings": [me.king_active, bot.king_active],
            "bot_hand": list(bot.hand), "bot_next": bot.next_card,
        }

    def _flush(self):
        out, self.out = self.out, []
        return out

    # ------------------------------------------------------------- play
    def reset(self, seed, scripted=""):
        self.scripted = None
        if scripted:
            from royalegym import ladder
            self.scripted = dict(ladder())[scripted]
        self.rng = np.random.default_rng(int(seed))
        self.out = []
        self.obs, _ = self.env.reset(seed=int(seed))
        return json.dumps({"events": self._flush(), "mask": self.blue_mask(), "state_hash": self.state_hash()})

    def blue_mask(self):
        m = np.asarray(self.obs["blue"]["action_mask"]).astype(bool)
        return base64.b64encode(np.packbits(m[1:])).decode()

    def bot_inputs(self):
        """The network inputs for the red seat (EvalActors.obs_batch, frame stack 1) and its mask."""
        o = self.obs["red"]
        n = 4 * self.ny * self.nx
        mask = np.asarray(o["action_mask"]).astype(np.uint8)
        planes = mask[1:1 + n].astype(np.float32)
        return [np.ascontiguousarray(np.asarray(o["spatial"], dtype=np.float32)).tobytes(),
                planes.tobytes(),
                np.ascontiguousarray(np.asarray(o["vector"], dtype=np.float32)).tobytes(),
                mask.tobytes()]

    def scripted_action(self):
        o = self.obs["red"]
        return int(self.scripted.act(o, o["action_mask"], self.rng))

    def step(self, a_blue, a_red):
        mb = self.obs["blue"]["action_mask"]
        mr = self.obs["red"]["action_mask"]
        a_blue = int(a_blue) if 0 <= int(a_blue) < len(mb) and mb[int(a_blue)] else 0
        a_red = int(a_red) if 0 <= int(a_red) < len(mr) and mr[int(a_red)] else 0
        self.obs, *_ = self.env.step({"blue": a_blue, "red": a_red})
        done = not self.env.agents
        res = {"events": self._flush(), "done": done, "blue_ok": a_blue != 0}
        if done:
            s = self.env.battle_state
            res["end"] = {"winner": int(s.winner), "crowns": [p.crowns for p in s.players]}
        else:
            res["mask"] = self.blue_mask()
        return json.dumps(res)

    def state_hash(self):
        return hex(self.engine.state_hash())

    def replay_bytes(self):
        """The battle as a .msgpack trace, the file royaleviser opens."""
        import msgspec
        return msgspec.msgpack.encode(self.rec.trace) if self.rec.trace is not None else b""
