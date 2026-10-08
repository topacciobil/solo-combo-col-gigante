"""Engine equivalence check: the same scripted battle, the state hash after every decision.

Run natively (python site/py/hash_test.py > ref.json) and in the browser (test.html); every hash
must match, which shows the WebAssembly engine plays exactly the battles the bot trained on.
"""
import json

import numpy as np


def run(Game, seed=12345, decisions=400):
    g = Game()
    g.reset(seed, "patient")
    hashes = [g.state_hash()]
    k = 0
    while not g.env.agents == [] and k < decisions:
        mask = np.asarray(g.obs["blue"]["action_mask"])
        legal = np.flatnonzero(mask[1:]) + 1
        # A fixed rule for blue: every 6th decision, the legal play in the middle of the list.
        a_blue = int(legal[len(legal) // 2]) if (k % 6 == 0 and len(legal)) else 0
        res = json.loads(g.step(a_blue, g.scripted_action()))
        hashes.append(g.state_hash())
        k += 1
        if res["done"]:
            break
    return {"seed": seed, "decisions": k, "hashes": hashes}


if __name__ == "__main__":
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from game import Game
    print(json.dumps(run(Game)))
