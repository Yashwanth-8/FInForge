"""
FinForge Graph Engine v4
Detects: Cycle Rings · Smurfing (Fan-in/Fan-out) · Shell Networks

Changes over v3:
- Graph payload now sends ALL nodes (up to 800) so the frontend can show the
  full transaction network with fraud highlighted, not just the fraud subgraph
- MAX_GRAPH_NODES raised from 300 → 800
- Normal nodes always included; suspicious nodes take priority if cap is hit
"""

import pandas as pd
import numpy as np
from collections import defaultdict
from typing import Dict, List, Set, Tuple, Any


class GraphEngine:
    CYCLE_MIN = 3
    CYCLE_MAX = 5
    CYCLE_MAX_RESULTS = 500          # hard cap: prevents exponential blowup on dense graphs
    SMURF_THRESHOLD = 10             # min unique partners for fan-in/out
    SHELL_MAX_TX = 3                 # max total tx for a "shell" node
    SHELL_MIN_CHAIN = 3              # min hops in a shell chain
    SHELL_MIN_INTERMEDIARY = 2       # min shell intermediaries required
    SHELL_MAX_STEPS = 50_000         # BFS budget: guarantees termination on large graphs
    WINDOW_72H = pd.Timedelta("72h")
    WINDOW_24H = pd.Timedelta("24h")
    MERCHANT_IN_DEGREE = 12
    PAYROLL_OUT_DEGREE = 15
    MAX_SHELL_RESULTS = 300
    MAX_GRAPH_NODES = 800            # max nodes sent to frontend

    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        self.adj: Dict[str, Set[str]] = defaultdict(set)
        self.rev: Dict[str, Set[str]] = defaultdict(set)
        self.node_stats: Dict[str, Dict] = {}
        self.edge_list: List[Dict] = []
        self._edges_by_source: Dict[str, List[Dict]] = defaultdict(list)
        self._edges_by_target: Dict[str, List[Dict]] = defaultdict(list)

    # ─── BUILD GRAPH ──────────────────────────────────────────────────────────
    def _build_graph(self):
        stats: Dict[str, Dict] = defaultdict(lambda: {
            "tx_in": 0, "tx_out": 0,
            "total_in": 0.0, "total_out": 0.0,
            "timestamps": [],
        })

        for _, row in self.df.iterrows():
            s, r = str(row["sender_id"]), str(row["receiver_id"])
            amt = float(row["amount"])
            ts = row["timestamp"]

            self.adj[s].add(r)
            self.rev[r].add(s)

            stats[s]["tx_out"] += 1
            stats[s]["total_out"] += amt
            stats[s]["timestamps"].append(ts)

            stats[r]["tx_in"] += 1
            stats[r]["total_in"] += amt
            stats[r]["timestamps"].append(ts)

            edge = {"source": s, "target": r, "amount": amt, "ts": ts}
            self.edge_list.append(edge)
            self._edges_by_source[s].append(edge)
            self._edges_by_target[r].append(edge)

        for nid, st in stats.items():
            st["tx_total"] = st["tx_in"] + st["tx_out"]
            st["timestamps"] = sorted([t for t in st["timestamps"] if pd.notna(t)])
            self.node_stats[nid] = st

        for nid in set(self.adj) | set(self.rev):
            if nid not in self.node_stats:
                self.node_stats[nid] = {
                    "tx_in": 0, "tx_out": 0, "total_in": 0.0,
                    "total_out": 0.0, "timestamps": [], "tx_total": 0,
                }

    # ─── CYCLE DETECTION ──────────────────────────────────────────────────────
    def _detect_cycles(self) -> List[List[str]]:
        cycles: List[List[str]] = []
        all_nodes = sorted(self.node_stats.keys())

        def dfs(start: str, current: str, path: List[str], on_path: Set[str]):
            # Hard cap: exit immediately once we have enough cycles
            if len(cycles) >= self.CYCLE_MAX_RESULTS:
                return
            if len(path) > self.CYCLE_MAX:
                return
            for neighbor in sorted(self.adj.get(current, set())):
                if len(cycles) >= self.CYCLE_MAX_RESULTS:
                    return
                if neighbor == start and len(path) >= self.CYCLE_MIN:
                    cycles.append(list(path))
                    continue
                if (neighbor not in on_path
                        and neighbor > start):
                    path.append(neighbor)
                    on_path.add(neighbor)
                    dfs(start, neighbor, path, on_path)
                    path.pop()
                    on_path.discard(neighbor)

        for node in all_nodes:
            if len(cycles) >= self.CYCLE_MAX_RESULTS:
                break
            dfs(node, node, [node], {node})

        # Deduplicate by frozenset of members
        seen: Set[frozenset] = set()
        unique: List[List[str]] = []
        for c in cycles:
            key = frozenset(c)
            if key not in seen:
                seen.add(key)
                unique.append(c)

        return unique

    # ─── TEMPORAL WINDOW HELPER ───────────────────────────────────────────────
    def _max_in_window(self, timestamps: List[pd.Timestamp], window: pd.Timedelta) -> int:
        if not timestamps:
            return 0
        ts = sorted(timestamps)
        max_count, j = 0, 0
        for i in range(len(ts)):
            while ts[i] - ts[j] > window:
                j += 1
            max_count = max(max_count, i - j + 1)
        return max_count

    # ─── AMOUNT DECAY HELPER (layering signal) ────────────────────────────────
    def _has_amount_decay(self, cycle_nodes: List[str]) -> bool:
        if len(cycle_nodes) < 3:
            return False
        amounts = []
        n = len(cycle_nodes)
        for i in range(n):
            s = cycle_nodes[i]
            r = cycle_nodes[(i + 1) % n]
            edges_between = [
                e["amount"] for e in self._edges_by_source.get(s, [])
                if e["target"] == r
            ]
            if not edges_between:
                return False
            amounts.append(max(edges_between))

        for i in range(1, len(amounts)):
            ratio = amounts[i] / amounts[i - 1] if amounts[i - 1] > 0 else 1
            if not (0.65 <= ratio <= 0.98):
                return False
        return True

    # ─── CYCLE TEMPORAL SCORE ─────────────────────────────────────────────────
    def _cycle_temporal_score(self, cycle_nodes: List[str]) -> float:
        timestamps = []
        n = len(cycle_nodes)
        for i in range(n):
            s = cycle_nodes[i]
            r = cycle_nodes[(i + 1) % n]
            for e in self._edges_by_source.get(s, []):
                if e["target"] == r and pd.notna(e["ts"]):
                    timestamps.append(e["ts"])
        if not timestamps:
            return 0.0
        span = max(timestamps) - min(timestamps)
        if span <= self.WINDOW_72H:
            return 8.0
        elif span <= pd.Timedelta("168h"):
            return 4.0
        return 0.0

    # ─── SMURFING DETECTION ───────────────────────────────────────────────────
    def _detect_smurfing(self) -> Dict[str, Dict]:
        suspicious: Dict[str, Dict] = {}

        for nid in self.node_stats:
            senders   = list(self.rev.get(nid, set()))
            receivers = list(self.adj.get(nid, set()))

            # Fan-in
            if len(senders) >= self.SMURF_THRESHOLD:
                in_ts = [e["ts"] for e in self._edges_by_target.get(nid, []) if pd.notna(e["ts"])]
                window_count = self._max_in_window(in_ts, self.WINDOW_72H)
                score = min(100.0, 40 + (len(senders) - self.SMURF_THRESHOLD) * 3 + window_count * 2)
                suspicious[nid] = {
                    "type": "fan_in",
                    "partners": senders,
                    "score": score,
                    "window_count": window_count,
                }

            # Fan-out
            if len(receivers) >= self.SMURF_THRESHOLD:
                out_ts = [e["ts"] for e in self._edges_by_source.get(nid, []) if pd.notna(e["ts"])]
                window_count = self._max_in_window(out_ts, self.WINDOW_72H)
                score = min(100.0, 40 + (len(receivers) - self.SMURF_THRESHOLD) * 3 + window_count * 2)
                if nid not in suspicious or suspicious[nid]["score"] < score:
                    suspicious[nid] = {
                        "type": "fan_out",
                        "partners": receivers,
                        "score": score,
                        "window_count": window_count,
                    }

        return suspicious

    # ─── SHELL NETWORK DETECTION ──────────────────────────────────────────────
    def _detect_shell_networks(self) -> List[Dict]:
        shells: List[Dict] = []
        seen_paths: Set[str] = set()
        total_steps = 0  # BFS step counter — guarantees termination

        for start in sorted(self.node_stats.keys()):
            if len(shells) >= self.MAX_SHELL_RESULTS:
                break
            if total_steps >= self.SHELL_MAX_STEPS:
                break

            queue = [[start]]
            enqueued: Set[str] = {start}

            while queue:
                if total_steps >= self.SHELL_MAX_STEPS:
                    break
                if len(shells) >= self.MAX_SHELL_RESULTS:
                    break

                path = queue.pop(0)
                total_steps += 1

                if len(path) > 6:
                    continue

                cur = path[-1]
                for nxt in sorted(self.adj.get(cur, set())):
                    if nxt in enqueued:
                        continue
                    new_path = path + [nxt]
                    path_key = "->".join(new_path)
                    if path_key in seen_paths:
                        continue
                    seen_paths.add(path_key)

                    intermediaries = new_path[1:-1]
                    shell_count = sum(
                        1 for n in intermediaries
                        if self.node_stats.get(n, {}).get("tx_total", 99) <= self.SHELL_MAX_TX
                    )

                    if len(new_path) >= self.SHELL_MIN_CHAIN and shell_count >= self.SHELL_MIN_INTERMEDIARY:
                        shells.append({"path": new_path, "shell_count": shell_count})

                    enqueued.add(nxt)
                    queue.append(new_path)

        return shells[:self.MAX_SHELL_RESULTS]

    # ─── FALSE POSITIVE FILTER ────────────────────────────────────────────────
    def _get_legitimate_accounts(self) -> Set[str]:
        legit: Set[str] = set()
        for nid, stats in self.node_stats.items():
            in_deg  = len(self.rev.get(nid, set()))
            out_deg = len(self.adj.get(nid, set()))

            # High-volume merchant: many unique senders, very few unique receivers,
            # total inflow significantly > outflow
            if (in_deg >= self.MERCHANT_IN_DEGREE
                    and out_deg <= 5
                    and stats["total_in"] > stats["total_out"] * 2.0):
                legit.add(nid)

            # Payroll: disperses to many unique recipients, funded by very few sources
            if (out_deg >= self.PAYROLL_OUT_DEGREE
                    and in_deg <= 3):
                legit.add(nid)

            # Payroll intermediary: single large inflow, many similar-sized outflows
            if (stats["tx_in"] <= 3
                    and stats["tx_out"] >= self.PAYROLL_OUT_DEGREE
                    and stats["total_in"] > 0
                    and abs(stats["total_in"] - stats["total_out"]) / stats["total_in"] < 0.15):
                legit.add(nid)

        return legit

    # ─── RING CONSOLIDATION & SCORING ─────────────────────────────────────────
    def _build_rings_and_scores(
        self,
        cycles: List[List[str]],
        smurfing: Dict[str, Dict],
        shells: List[Dict],
        legit: Set[str],
    ) -> Tuple[List[Dict], List[Dict]]:

        account_flags: Dict[str, Dict] = defaultdict(lambda: {
            "patterns": set(), "ring_id": None, "score": 0.0
        })
        rings: List[Dict] = []
        ring_counter = 1

        def flag(acc: str, pattern: str, ring_id, score: float):
            if acc in legit:
                return
            f = account_flags[acc]
            f["patterns"].add(pattern)
            current = f["score"]
            f["score"] = min(100.0, current + score * (1 - current / 120.0))
            if ring_id and f["ring_id"] is None:
                f["ring_id"] = ring_id

        # ── Cycles ──────────────────────────────────────────────────────────
        for cycle in cycles:
            rid = f"RING_{ring_counter:03d}"
            ring_counter += 1
            cycle_len = len(set(cycle))
            base = {3: 85.0, 4: 80.0, 5: 75.0}.get(cycle_len, 70.0)
            temporal_bonus = self._cycle_temporal_score(cycle)
            decay_bonus = 6.0 if self._has_amount_decay(cycle) else 0.0
            risk = min(100.0, base + temporal_bonus + decay_bonus)

            members = [m for m in list(dict.fromkeys(cycle)) if m not in legit]
            if len(members) < 2:
                continue

            rings.append({
                "ring_id": rid,
                "member_accounts": members,
                "pattern_type": "cycle",
                "risk_score": round(risk, 1),
            })
            pattern_label = f"cycle_length_{cycle_len}"
            for acc in members:
                flag(acc, pattern_label, rid, base + temporal_bonus * 0.5)

        # ── Smurfing ─────────────────────────────────────────────────────────
        for acc, info in smurfing.items():
            if acc in legit:
                continue
            rid = f"RING_{ring_counter:03d}"
            ring_counter += 1

            # Only include hub + partners that aren't legit, cap partners at 20
            members = [m for m in [acc] + info["partners"][:20] if m not in legit]

            risk = info["score"]
            rings.append({
                "ring_id": rid,
                "member_accounts": list(dict.fromkeys(members)),
                "pattern_type": "smurfing",
                "risk_score": round(risk, 1),
            })

            # Hub gets the ring_id; peripheral members get flagged but NO ring_id
            # (they may be innocent customers — conservatively don't assign them a ring)
            if info["type"] in ("fan_in", "fan_out"):
                flag(acc, info["type"], rid, risk * 0.6)
            if info["window_count"] >= 5:
                flag(acc, "high_velocity", rid, info["window_count"] * 1.5)

            for m in members[1:]:  # peripheral members
                pat = ("fan_in_contributor" if info["type"] == "fan_in"
                       else "fan_out_receiver")
                flag(m, pat, None, risk * 0.3)  # None: no ring_id for peripherals

        # ── Shell networks ───────────────────────────────────────────────────
        for shell in shells:
            rid = f"RING_{ring_counter:03d}"
            ring_counter += 1
            members = [m for m in shell["path"] if m not in legit]
            if len(members) < 2:
                continue
            risk = min(100.0, 55 + shell["shell_count"] * 10 + len(shell["path"]) * 2)
            rings.append({
                "ring_id": rid,
                "member_accounts": list(dict.fromkeys(members)),
                "pattern_type": "shell_network",
                "risk_score": round(risk, 1),
            })
            for acc in members:
                flag(acc, "layered_shell", rid, risk * 0.5)

        # ── High velocity bonus pass ─────────────────────────────────────────
        for acc in list(account_flags.keys()):
            ts_list = [e["ts"] for e in self._edges_by_source.get(acc, [])
                       + self._edges_by_target.get(acc, []) if pd.notna(e["ts"])]
            w = self._max_in_window(ts_list, self.WINDOW_24H)
            if w >= 6:
                account_flags[acc]["patterns"].add("high_velocity")

        # Deduplicate rings by member overlap
        deduped = self._deduplicate_rings(rings)

        # Build set of ring IDs that survived dedup
        active_ring_ids = {ring["ring_id"] for ring in deduped}

        # Sync ring_id in suspicious_accounts to deduped ring IDs
        ring_id_lookup = {
            m: ring["ring_id"]
            for ring in deduped
            for m in ring["member_accounts"]
        }

        suspicious = []
        for acc, flags in account_flags.items():
            if flags["score"] < 1:
                continue
            # Resolve ring_id: use deduped lookup, fall back, or RING_UNKNOWN if orphaned
            assigned_ring = ring_id_lookup.get(acc) or flags["ring_id"]
            if assigned_ring and assigned_ring not in active_ring_ids:
                assigned_ring = "RING_UNKNOWN"
            suspicious.append({
                "account_id": acc,
                "suspicion_score": round(min(100.0, flags["score"]), 1),
                "detected_patterns": sorted(list(flags["patterns"])),
                "ring_id": assigned_ring or "RING_UNKNOWN",
            })
        suspicious.sort(key=lambda x: x["suspicion_score"], reverse=True)

        return suspicious, deduped

    def _deduplicate_rings(self, rings: List[Dict]) -> List[Dict]:
        kept, used_sets = [], []
        for ring in sorted(rings, key=lambda r: r["risk_score"], reverse=True):
            ms = set(ring["member_accounts"])
            dup = False
            for used in used_sets:
                overlap = len(ms & used) / max(1, min(len(ms), len(used)))
                if overlap > 0.85:
                    dup = True
                    break
            if not dup:
                kept.append(ring)
                used_sets.append(ms)
        # Re-number sequentially after dedup
        renumbered = []
        for i, ring in enumerate(kept, 1):
            ring = dict(ring)
            ring["ring_id"] = f"RING_{i:03d}"
            renumbered.append(ring)
        return renumbered

    # ─── BUILD GRAPH DATA FOR FRONTEND ───────────────────────────────────────
    # Sends ALL nodes and edges so the visualization shows the full transaction
    # network with fraud nodes highlighted. Capped at MAX_GRAPH_NODES (800)
    # total — suspicious nodes always take priority if the cap is hit.
    def _build_graph_payload(self, suspicious_set: Set[str], ring_map: Dict[str, str]) -> Dict:
        all_nodes = list(self.node_stats.keys())

        if len(all_nodes) <= self.MAX_GRAPH_NODES:
            display_set = set(all_nodes)
        else:
            normal_nodes = sorted(
                [n for n in all_nodes if n not in suspicious_set],
                key=lambda n: self.node_stats[n].get("tx_total", 0),
                reverse=True,
            )
            slots = self.MAX_GRAPH_NODES - len(suspicious_set)
            display_set = set(suspicious_set) | set(normal_nodes[:max(0, slots)])

        nodes = [
            {
                "id": nid,
                "tx_in": self.node_stats[nid]["tx_in"],
                "tx_out": self.node_stats[nid]["tx_out"],
                "tx_total": self.node_stats[nid]["tx_total"],
                "total_in": round(self.node_stats[nid]["total_in"], 2),
                "total_out": round(self.node_stats[nid]["total_out"], 2),
                "suspicious": nid in suspicious_set,
                "ring_id": ring_map.get(nid),
            }
            for nid in sorted(display_set)
        ]

        seen_edges: Set[str] = set()
        edges = []
        for e in self.edge_list:
            if e["source"] in display_set and e["target"] in display_set:
                key = f"{e['source']}|{e['target']}"
                if key not in seen_edges:
                    seen_edges.add(key)
                    edges.append({
                        "source": e["source"],
                        "target": e["target"],
                        "amount": round(e["amount"], 2),
                    })

        return {"nodes": nodes, "edges": edges}
    
    # ─── MAIN RUN ─────────────────────────────────────────────────────────────
    def run(self) -> Dict[str, Any]:
        self._build_graph()

        cycles   = self._detect_cycles()
        smurfing = self._detect_smurfing()
        shells   = self._detect_shell_networks()
        legit    = self._get_legitimate_accounts()

        suspicious, fraud_rings = self._build_rings_and_scores(cycles, smurfing, shells, legit)

        suspicious_set = {s["account_id"] for s in suspicious}
        ring_map = {
            m: ring["ring_id"]
            for ring in fraud_rings
            for m in ring["member_accounts"]
        }

        graph_data = self._build_graph_payload(suspicious_set, ring_map)

        return {
            "suspicious_accounts": suspicious,
            "fraud_rings": fraud_rings,
            "graph": graph_data,
            "summary": {
                "total_accounts_analyzed": len(self.node_stats),
                "total_transactions": len(self.df),
                "suspicious_accounts_flagged": len(suspicious),
                "fraud_rings_detected": len(fraud_rings),
                "cycles_found": len(cycles),
                "smurfing_hubs_found": len(smurfing),
                "shell_chains_found": len(shells),
                "processing_time_seconds": 0,
            },
        }