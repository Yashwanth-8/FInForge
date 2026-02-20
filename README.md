# FinForge — Financial Crime Detection Engine

> RIFT 2026 Hackathon · Graph Theory / Financial Crime Detection Track

**🔴 Live Demo:** `https://f-in-forge.vercel.app/`
**📁 GitHub:** `https://github.com/Yashwanth-8/FInForge`

---

## Project Title

**FinForge** — A web-based Financial Forensics Engine that processes transaction CSV data and exposes money muling networks through graph analysis and interactive visualization.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, D3.js (force-directed graph), CSS Modules |
| Backend | Python 3.11, FastAPI, Pandas, NumPy |
| Graph Engine | Custom adjacency-list graph · DFS cycle detection · BFS shell detection |
| Fonts | Syne (display) · Space Mono (data/mono) |
| Deployment | Frontend → Vercel · Backend → Render / Railway |

---

## System Architecture

```
CSV Upload (browser)
        │
        ▼
  FastAPI /analyze
        │
        ├── CSV parse & validation (Pandas)
        │
        ├── GraphEngine.build_graph()
        │       adjacency list   adj[src]  → {dst, ...}
        │       reverse index    rev[dst]  → {src, ...}
        │       per-node stats   tx_in, tx_out, total_in, total_out, timestamps
        │       per-edge index   _edges_by_source, _edges_by_target
        │
        ├── Detection Pipeline
        │       ├── _detect_cycles()          Johnson-style DFS, lengths 3–5
        │       ├── _detect_smurfing()        Fan-in / Fan-out degree analysis
        │       └── _detect_shell_networks()  BFS chain traversal
        │
        ├── _get_legitimate_accounts()        False positive suppression
        │
        ├── _build_rings_and_scores()         Ring consolidation + suspicion scoring
        │       └── _deduplicate_rings()      85% member overlap threshold
        │
        └── _build_graph_payload()            All nodes (up to 800) with suspicious flag
                │
                ▼
          JSON Response
                │
                ▼
        React Frontend
                ├── StatsStrip      summary KPIs
                ├── GraphPanel      D3 force-directed graph (two-layer rendering)
                ├── RingPanel       fraud ring cards
                ├── AccountsTable   suspicious accounts with score bars
                └── DownloadBar     JSON export button
```

**Key design decisions:**
- The graph renders **all nodes** — normal accounts as tiny background dots, fraud nodes as large glowing circles on top. This satisfies the spec requirement of showing all account nodes while keeping fraud rings visually dominant.
- The backend runs the simulation-heavy detection algorithms; the frontend is purely rendering.
- Simulation warmup (300 synchronous ticks) runs before any nodes are drawn, ensuring correct initial positions.

---

## Algorithm Approach

### 1. Cycle Detection — Circular Fund Routing

**Algorithm:** Modified Johnson's algorithm using canonical-ordering DFS.

For each node `s` (sorted for determinism):
- Run DFS from `s`, only traversing neighbors `n > s` (canonical ordering eliminates duplicate cycles)
- When a back-edge returns to `s` at path length 3–5, record the cycle
- Hard cap: 500 cycles to prevent exponential blowup on dense graphs

**Why canonical ordering?** Each cycle is detected exactly once from its lexicographically smallest member. Without this, the same cycle `[A→B→C→A]` would appear as `[B→C→A→B]` and `[C→A→B→C]` as well.

**Time complexity:** O(V · (V + E)) average with canonical pruning. Worst case O(2^V) on a complete graph, bounded in practice by the 500-cycle cap and the `neighbor > start` constraint.

**Space complexity:** O(V + E) for adjacency lists + O(cycle_length) DFS stack.

---

### 2. Smurfing Detection — Fan-in / Fan-out

**Algorithm:** Single-pass degree analysis over all nodes.

- **Fan-in:** `|unique_senders| ≥ 10` → aggregator hub flagged
- **Fan-out:** `|unique_receivers| ≥ 10` → dispersal hub flagged
- **Temporal scoring:** Two-pointer sliding window over sorted timestamps counts max transactions within 72 hours

```
sorted timestamps: [t0, t1, ..., tn]
maintain left pointer j
advance j while ts[i] - ts[j] > 72h
max_window = max(i - j + 1)
```

**Time complexity:** O(V + E) — single pass over all nodes and their edge lists.

**Space complexity:** O(V) for per-node partner sets.

---

### 3. Shell Network Detection — Layered Chains

**Algorithm:** BFS path enumeration from each node, identifying chains where interior nodes have ≤ 3 total transactions.

- Minimum chain length: 3 hops
- Minimum shell intermediaries: 2
- Maximum chain depth: 6 hops
- Hard budget: 50,000 BFS steps total (guarantees termination)

**Why BFS over DFS?** BFS finds shortest shell chains first — shorter chains are more structurally suspicious as they represent tighter control over fund movement.

**Time complexity:** O(min(V · E, 50000)) — the step budget guarantees termination regardless of graph density.

**Space complexity:** O(path_length · frontier_size) for BFS queue.

---

### 4. Amount Decay Detection (Layering Signal)

Within detected cycles, checks whether transaction amounts show a consistent 2–35% decline per hop — a classic layering signal where fees or skimming reduce each transfer.

```
ratio = amounts[i] / amounts[i-1]
decay confirmed if: 0.65 ≤ ratio ≤ 0.98 for all i
```

Adds +6.0 to the cycle's risk score when confirmed.

---

## Suspicion Score Methodology

Each account receives a score in [0, 100] built from evidence contributions with **diminishing returns** to prevent any single signal from dominating:

```
new_score = current + contribution × (1 − current / 120)
```

This ensures scores saturate realistically. A score of 80 absorbs a new contribution at only 33% weight, preventing weak stacked signals from inflating scores to artificial 100s.

### Score Contributions by Pattern

| Pattern | Base Contribution | Notes |
|---|---|---|
| Cycle length 3 | 85.0 | Strongest signal |
| Cycle length 4 | 80.0 | |
| Cycle length 5 | 75.0 | |
| Temporal bonus (all tx within 72h) | +8.0 | Added to cycle base |
| Temporal bonus (all tx within 1 week) | +4.0 | |
| Amount decay in cycle | +6.0 | Layering signal |
| Fan-in / Fan-out hub | 40 + (partners − 10) × 3 + window_count × 2 | Capped at 100 |
| High velocity (6+ tx in 24h) | window_count × 1.5 | Additive bonus |
| Fan-in contributor / Fan-out receiver | hub_score × 0.3 | No ring_id assigned |
| Shell chain member | (55 + shell_count×10 + hops×2) × 0.5 | |

### False Positive Suppression

Accounts are classified as **legitimate** and excluded from all detection if they match:

1. **High-volume merchant:** `in_degree ≥ 12 AND out_degree ≤ 5 AND total_in > 2× total_out`
2. **Payroll disbursement:** `out_degree ≥ 15 AND in_degree ≤ 3`
3. **Payroll intermediary:** `tx_in ≤ 3 AND tx_out ≥ 15 AND |total_in − total_out| / total_in < 15%`

Ring deduplication uses an **85% member overlap threshold** — if two rings share more than 85% of their members, only the higher-scoring ring is kept. All rings are renumbered sequentially after deduplication.

---

## Installation & Setup

### Prerequisites
- Node.js ≥ 18
- Python ≥ 3.10

### Backend
```bash
cd backend
pip install fastapi uvicorn pandas numpy python-multipart
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`. Requests to `/analyze` and `/sample` are proxied to the backend via `vite.config.js`:

```js
server: {
  proxy: {
    '/analyze': 'http://localhost:8000',
    '/sample':  'http://localhost:8000',
  }
}
```

---

## Usage Instructions

1. Open `http://localhost:5173` in your browser
2. Upload a CSV file with columns: `transaction_id, sender_id, receiver_id, amount, timestamp`
   - Timestamp format: `YYYY-MM-DD HH:MM:SS`
   - Supports up to 10,000 transactions
3. Or click **"Load built-in sample dataset"** to see all three detection patterns in action
4. Results appear automatically:
   - **Stats strip** — total accounts, flagged accounts, rings detected, processing time
   - **Graph panel** — interactive D3 force-directed graph; all accounts shown; fraud nodes glow; drag to reposition, scroll to zoom, hover for details
   - **Ring panel** — click any ring card to expand and see member account list
   - **Accounts table** — top suspicious accounts sorted by score with pattern tags
5. Click **Download JSON Report** to export the structured result in the required format

---

## Known Limitations

- **Cycle detection is capped at 500 cycles** — on extremely dense fraud graphs, some length-4 and length-5 cycles may be missed in favour of the first 500 found. This trades recall for guaranteed sub-30s processing.
- **Shell detection uses a 50,000-step BFS budget** — very large sparse graphs with many low-activity accounts may have some shell chains missed if the budget is exhausted before all start nodes are explored.
- **Smurfing peripheral members** (fan-in contributors and fan-out receivers) are flagged with patterns but not assigned a ring ID. This is intentional — they may be innocent customers of a legitimate business. Only the hub account is ring-associated.
- **Graph visualization** shows up to 800 nodes total. On datasets with more than 800 unique accounts, all suspicious nodes are always included; normal nodes are sampled by highest degree.
- **Timestamp parsing** supports `YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS`, `YYYY/MM/DD HH:MM:SS`, `DD/MM/YYYY HH:MM:SS`. Other formats fall back to Pandas inference and may lose temporal precision, reducing the accuracy of temporal bonuses.
- **No server-side persistence** — results are not stored; refreshing the page clears all state.
- **Single CSV upload only** — multi-file or streaming ingestion is not supported in this version.
- **CORS in production** — the current config uses `allow_origins=["*"]`. For production deployment, replace with the actual frontend URL.

---

## Team Members

- K Srinivas Yashwanth
- Nagaraja M
- Maanya Naveen Kumar
