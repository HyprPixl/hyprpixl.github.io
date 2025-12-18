"""
Signal Foundry - a terminal incremental game about reactivating a dormant space beacon.

Play with:
    python3 scripts/signal_foundry.py
"""
from __future__ import annotations

import json
import random
import shlex
import textwrap
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

SAVE_PATH = Path(__file__).with_name("signal_foundry_save.json")


def _now() -> float:
    return time.monotonic()


def format_number(value: float) -> str:
    if value >= 1_000_000_000:
        return f"{value/1_000_000_000:.2f}b"
    if value >= 1_000_000:
        return f"{value/1_000_000:.2f}m"
    if value >= 10_000:
        return f"{value:,.0f}"
    if value >= 100:
        return f"{value:,.1f}"
    return f"{value:.2f}"


@dataclass
class Generator:
    key: str
    name: str
    description: str
    base_rate: float
    base_cost: float
    scaling: float
    unlocks_at: float
    count: int = 0
    bonus: float = 0.0  # additive percentage increase (0.2 = +20%)

    def unlocked(self, signal: float) -> bool:
        return signal >= self.unlocks_at or self.count > 0

    def rate_per_unit(self, global_multiplier: float) -> float:
        return self.base_rate * (1 + self.bonus) * global_multiplier

    def total_rate(self, global_multiplier: float) -> float:
        return self.count * self.rate_per_unit(global_multiplier)

    def cost_for(self, amount: int) -> float:
        if amount <= 0:
            return 0.0
        start = self.scaling ** self.count
        numerator = self.scaling**amount - 1
        cost = self.base_cost * start * numerator / (self.scaling - 1)
        return cost


@dataclass
class Upgrade:
    key: str
    name: str
    description: str
    cost: float
    apply: str
    purchased: bool = False


@dataclass
class GameState:
    signal: float = 0.0
    intel: int = 0
    shards: int = 0
    total_generated: float = 0.0
    manual_power: float = 1.0
    global_bonus: float = 0.0
    last_tick: float = field(default_factory=_now)
    momentum_effects: List[Tuple[float, float]] = field(default_factory=list)
    generators: Dict[str, Generator] = field(default_factory=dict)
    upgrades: Dict[str, Upgrade] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.generators:
            self.generators = {
                "drone": Generator(
                    key="drone",
                    name="Scavenger Drone",
                    description="Autonomous collectors comb the wreckage for stray signal.",
                    base_rate=1.0,
                    base_cost=10,
                    scaling=1.12,
                    unlocks_at=0,
                ),
                "array": Generator(
                    key="array",
                    name="Antenna Array",
                    description="Amplifies whispers from the void into clean bandwidth.",
                    base_rate=6.0,
                    base_cost=75,
                    scaling=1.15,
                    unlocks_at=60,
                ),
                "archive": Generator(
                    key="archive",
                    name="Deep Archive",
                    description="Ancient cores decode buried transmissions in parallel.",
                    base_rate=32.0,
                    base_cost=450,
                    scaling=1.17,
                    unlocks_at=350,
                ),
                "gate": Generator(
                    key="gate",
                    name="Beacon Gate",
                    description="Rings the entire station, resonating with distant stars.",
                    base_rate=140.0,
                    base_cost=1900,
                    scaling=1.2,
                    unlocks_at=1200,
                ),
            }
        if not self.upgrades:
            self.upgrades = {
                "focused-ping": Upgrade(
                    key="focused-ping",
                    name="Focused Ping",
                    description="Manual pings now strike rich pockets of signal (+200%).",
                    cost=40,
                    apply="manual_power+=2",
                ),
                "drone-synchrony": Upgrade(
                    key="drone-synchrony",
                    name="Drone Synchrony",
                    description="Scavenger drones share paths (+50% rate).",
                    cost=120,
                    apply="generator:drone:+0.5",
                ),
                "signal-feedback": Upgrade(
                    key="signal-feedback",
                    name="Signal Feedback",
                    description="The beacon’s hum stabilizes all output (+20% global).",
                    cost=320,
                    apply="global_bonus+=0.2",
                ),
                "neural-maps": Upgrade(
                    key="neural-maps",
                    name="Neural Maps",
                    description="Arrays follow predictive routes (+70% rate).",
                    cost=800,
                    apply="generator:array:+0.7",
                ),
                "archive-oracles": Upgrade(
                    key="archive-oracles",
                    name="Archive Oracles",
                    description="Deep archives anticipate codebooks (+60% rate).",
                    cost=1800,
                    apply="generator:archive:+0.6",
                ),
                "gate-oversurge": Upgrade(
                    key="gate-oversurge",
                    name="Gate Oversurge",
                    description="Beacon gates ride the carrier wave (+50% rate).",
                    cost=2800,
                    apply="generator:gate:+0.5",
                ),
            }

    # --- progression helpers -------------------------------------------------
    def _active_momentum(self) -> float:
        now = _now()
        self.momentum_effects = [(b, e) for b, e in self.momentum_effects if e > now]
        return sum(b for b, _ in self.momentum_effects)

    def global_multiplier(self) -> float:
        shard_bonus = 0.12 * self.shards
        intel_bonus = 0.05 * self.intel
        momentum_bonus = self._active_momentum()
        return (1 + self.global_bonus + shard_bonus + intel_bonus) * (1 + momentum_bonus)

    def tick(self) -> None:
        now = _now()
        delta = now - self.last_tick
        if delta <= 0:
            return
        rate = sum(gen.total_rate(self.global_multiplier()) for gen in self.generators.values())
        gained = rate * delta
        self.signal += gained
        self.total_generated += gained
        self.last_tick = now

    def ping(self, amount: int = 1) -> float:
        gained = amount * self.manual_power * self.global_multiplier()
        self.signal += gained
        self.total_generated += gained
        return gained

    def venture(self) -> str:
        cost = 150
        if self.signal < cost:
            return "Not enough signal to stage a venture."
        self.tick()
        self.signal -= cost
        roll = random.random()
        if roll < 0.7:
            intel_gain = random.randint(1, 3)
            self.intel += intel_gain
            return f"Your prospectors find encrypted glyphs. Intel +{intel_gain}."
        if roll < 0.9:
            momentum = 0.35
            duration = 45
            self.momentum_effects.append((momentum, _now() + duration))
            bonus_signal = random.randint(50, 120)
            self.signal += bonus_signal
            self.total_generated += bonus_signal
            return (
                f"A collapsing conduit supercharges the beacon! +{format_number(bonus_signal)} signal, "
                f"+35% production for {duration}s."
            )
        lost = random.randint(50, 120)
        self.signal = max(self.signal - lost, 0)
        return "Venture fizzles—an empty husk. Crew morale dips, but they learn from it."

    def ignite(self) -> str:
        if self.total_generated < 15_000:
            needed = 15_000 - self.total_generated
            return f"The beacon is shy of ignition. Generate {format_number(needed)} more signal."
        shards_gained = max(1, int((self.total_generated // 15_000)))
        self.shards += shards_gained
        self.signal = 0
        self.intel = 0
        self.total_generated = 0
        self.manual_power = 1.0
        self.global_bonus = 0.0
        self.momentum_effects.clear()
        for gen in self.generators.values():
            gen.count = 0
            gen.bonus = 0.0
        for upgrade in self.upgrades.values():
            upgrade.purchased = False
        self.last_tick = _now()
        return (
            f"The beacon ignites, resetting your rig but seeding {shards_gained} star shard(s)! "
            "Each shard grants +12% permanent production."
        )

    # --- persistence ---------------------------------------------------------
    def save(self, path: Path = SAVE_PATH) -> None:
        payload = {
            "signal": self.signal,
            "intel": self.intel,
            "shards": self.shards,
            "total_generated": self.total_generated,
            "manual_power": self.manual_power,
            "global_bonus": self.global_bonus,
            "last_tick": time.time(),
            "momentum_effects": self.momentum_effects,
            "generators": {k: asdict(v) for k, v in self.generators.items()},
            "upgrades": {k: asdict(v) for k, v in self.upgrades.items()},
        }
        path.write_text(json.dumps(payload, indent=2))

    @classmethod
    def load(cls, path: Path = SAVE_PATH) -> "GameState":
        if not path.exists():
            return cls()
        data = json.loads(path.read_text())
        state = cls()
        state.signal = data.get("signal", 0.0)
        state.intel = data.get("intel", 0)
        state.shards = data.get("shards", 0)
        state.total_generated = data.get("total_generated", 0.0)
        state.manual_power = data.get("manual_power", 1.0)
        state.global_bonus = data.get("global_bonus", 0.0)
        past = data.get("last_tick", time.time())
        offline_seconds = max(0.0, time.time() - past)
        state.last_tick = _now() - offline_seconds
        state.momentum_effects = [tuple(effect) for effect in data.get("momentum_effects", [])]
        for key, payload in data.get("generators", {}).items():
            if key in state.generators:
                state.generators[key].count = payload.get("count", 0)
                state.generators[key].bonus = payload.get("bonus", 0.0)
        for key, payload in data.get("upgrades", {}).items():
            if key in state.upgrades:
                state.upgrades[key].purchased = payload.get("purchased", False)
        if offline_seconds > 0:
            state.tick()
        return state


# --- command handling --------------------------------------------------------

def describe_generators(state: GameState) -> str:
    lines = ["Generators:"]
    for gen in state.generators.values():
        if not gen.unlocked(state.signal):
            continue
        rate = gen.rate_per_unit(state.global_multiplier())
        lines.append(
            f"- {gen.key} ({gen.name}): {gen.count} owned | "
            f"{format_number(rate)} signal/s each | cost {format_number(gen.base_cost)} +"
            f" scales {gen.scaling:.2f}x"
        )
        lines.append(f"    {gen.description}")
    return "\n".join(lines)


def describe_upgrades(state: GameState) -> str:
    lines = ["Upgrades:"]
    for up in state.upgrades.values():
        status = "purchased" if up.purchased else f"{format_number(up.cost)} signal"
        lines.append(f"- {up.key} ({up.name}): {status}")
        lines.append(f"    {up.description}")
    return "\n".join(lines)


def status(state: GameState) -> str:
    state.tick()
    momentum_pct = state._active_momentum() * 100
    total_rate = sum(gen.total_rate(state.global_multiplier()) for gen in state.generators.values())
    return textwrap.dedent(
        f"""
        Signal Foundry Status
        --------------------
        Signal: {format_number(state.signal)} | Rate: {format_number(total_rate)} /s
        Intel: {state.intel} | Star Shards: {state.shards}
        Manual ping: {format_number(state.manual_power * state.global_multiplier())} signal
        Global boost: {state.global_multiplier():.2f}x (momentum: +{momentum_pct:.0f}%)

        {describe_generators(state)}

        {describe_upgrades(state)}
        """
    ).strip()


def buy_generator(state: GameState, key: str, amount: int) -> str:
    if key not in state.generators:
        return "No generator with that key."
    gen = state.generators[key]
    if not gen.unlocked(state.signal):
        return "That generator is still buried beneath debris. Generate more signal to find it."
    state.tick()
    cost = gen.cost_for(amount)
    if state.signal < cost:
        return f"Need {format_number(cost - state.signal)} more signal to buy {amount} {gen.name}(s)."
    state.signal -= cost
    gen.count += amount
    return f"Purchased {amount}x {gen.name}."


def buy_upgrade(state: GameState, key: str) -> str:
    if key not in state.upgrades:
        return "No upgrade with that key."
    upgrade = state.upgrades[key]
    if upgrade.purchased:
        return "Upgrade already integrated."
    state.tick()
    if state.signal < upgrade.cost:
        return f"Need {format_number(upgrade.cost - state.signal)} more signal."
    state.signal -= upgrade.cost
    upgrade.purchased = True
    apply_upgrade(state, upgrade)
    return f"Upgrade applied: {upgrade.name}."


def apply_upgrade(state: GameState, upgrade: Upgrade) -> None:
    if upgrade.apply.startswith("manual_power"):
        delta = float(upgrade.apply.split("+=")[-1])
        state.manual_power += delta
        return
    if upgrade.apply.startswith("global_bonus"):
        delta = float(upgrade.apply.split("+=")[-1])
        state.global_bonus += delta
        return
    if upgrade.apply.startswith("generator:"):
        _, key, change = upgrade.apply.split(":")
        delta = float(change)
        if key in state.generators:
            state.generators[key].bonus += delta


def parse_amount(value: str) -> int:
    if value == "max":
        return 9999
    try:
        return max(1, int(value))
    except ValueError:
        return 1


def help_text() -> str:
    return textwrap.dedent(
        """
        Commands
        --------
        help                        Show this message
        status                      Show your current run
        ping [n]                    Manual ping to gain signal (default 1)
        buy <generator> [n|max]     Purchase generators
        upgrade <key>               Buy an upgrade
        venture                     Spend 150 signal to hunt intel or momentum
        ignite                      Prestige once you've generated 15k total signal
        save                        Save to scripts/signal_foundry_save.json
        load                        Load a saved game
        reset                       Wipe the current save
        quit/exit                   Leave the game
        """
    ).strip()


def intro() -> str:
    return textwrap.dedent(
        """
        Signal Foundry
        --------------
        You dock with a silent beacon adrift between stars. Its memory cores
        promise power, but only if you rebuild the signal lattice.

        Raise signal, acquire intel from risky ventures, and ignite the beacon
        to lock in permanent star shards. Type 'help' to see commands.
        """
    ).strip()


def game_loop(state: GameState) -> None:
    print(intro())
    while True:
        state.tick()
        try:
            command = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye. Progress saved.")
            state.save()
            return
        if not command:
            continue
        parts = shlex.split(command)
        action = parts[0].lower()
        args = parts[1:]

        if action in {"quit", "exit"}:
            state.save()
            print("Progress saved. See you next drift.")
            return
        if action == "help":
            print(help_text())
            continue
        if action == "status":
            print(status(state))
            continue
        if action == "ping":
            amount = parse_amount(args[0]) if args else 1
            gained = state.ping(amount)
            print(f"Pulsed the lattice for {format_number(gained)} signal.")
            continue
        if action == "buy":
            if not args:
                print("Usage: buy <generator> [amount]")
                continue
            key = args[0]
            amount = parse_amount(args[1]) if len(args) > 1 else 1
            message = buy_generator(state, key, amount)
            print(message)
            continue
        if action == "upgrade":
            if not args:
                print("Usage: upgrade <key>")
                continue
            message = buy_upgrade(state, args[0])
            print(message)
            continue
        if action == "venture":
            print(state.venture())
            continue
        if action == "ignite":
            print(state.ignite())
            continue
        if action == "save":
            state.save()
            print(f"Saved to {SAVE_PATH}.")
            continue
        if action == "load":
            loaded = GameState.load()
            state.__dict__.update(loaded.__dict__)
            print("Loaded save and recalculated offline gains.")
            continue
        if action == "reset":
            confirm = input("Type 'YES' to delete your save: ")
            if confirm.strip().upper() == "YES":
                if SAVE_PATH.exists():
                    SAVE_PATH.unlink()
                state.__dict__.update(GameState().__dict__)
                print("Save wiped. Fresh beacon awaits.")
            else:
                print("Reset canceled.")
            continue

        print("Unknown command. Type 'help' to see available actions.")


def main() -> None:
    state = GameState.load()
    game_loop(state)


if __name__ == "__main__":
    main()
