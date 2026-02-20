import pandas as pd
from datetime import datetime, timedelta
import random


def generate_sample_df() -> pd.DataFrame:
    rows = []
    tx_id = 1
    base = datetime(2024, 1, 15, 10, 0, 0)

    def add(s, r, amt, hours):
        nonlocal tx_id
        rows.append({
            "transaction_id": f"TX_{tx_id:05d}",
            "sender_id": s,
            "receiver_id": r,
            "amount": amt,
            "timestamp": base + timedelta(hours=hours),
        })
        tx_id += 1

    # Pattern 1: 3-hop cycle ring
    add("ACC_A001", "ACC_A002", 5000, 0)
    add("ACC_A002", "ACC_A003", 4800, 2)
    add("ACC_A003", "ACC_A001", 4600, 5)
    add("ACC_A001", "ACC_A002", 3200, 24)
    add("ACC_A002", "ACC_A004", 3000, 26)
    add("ACC_A004", "ACC_A001", 2900, 30)

    # Pattern 2: 4-hop cycle
    add("ACC_B001", "ACC_B002", 8000, 1)
    add("ACC_B002", "ACC_B003", 7800, 3)
    add("ACC_B003", "ACC_B004", 7500, 6)
    add("ACC_B004", "ACC_B001", 7200, 10)

    # Pattern 3: Smurfing fan-in (14 senders → 1 aggregator)
    for i in range(1, 15):
        add(f"ACC_C{i:03d}", "ACC_C_AGG", 500 + i * 10, i * 0.5)
    add("ACC_C_AGG", "ACC_C_OUT1", 3000, 20)
    add("ACC_C_AGG", "ACC_C_OUT2", 2800, 21)

    # Pattern 4: Smurfing fan-out (1 hub → 13 receivers)
    add("ACC_D_SRC", "ACC_D_HUB", 15000, 0)
    for i in range(1, 14):
        add("ACC_D_HUB", f"ACC_D{i:03d}", 900 + i * 5, i * 2)

    # Pattern 5: Shell network (3 low-tx intermediaries)
    add("ACC_E_SRC", "ACC_E_SH1", 12000, 0)
    add("ACC_E_SH1", "ACC_E_SH2", 11800, 5)
    add("ACC_E_SH2", "ACC_E_SH3", 11600, 12)
    add("ACC_E_SH3", "ACC_E_DEST", 11400, 20)

    # Legitimate: merchant (many in, few out → should NOT be flagged)
    for i in range(1, 22):
        add(f"ACC_CUST{i:03d}", "ACC_MERCHANT", 50 + i * 5, i)
    add("ACC_MERCHANT", "ACC_SUPPLIER", 900, 100)

    # Legitimate: payroll (1 employer → many employees → should NOT be flagged)
    add("ACC_EMPLOYER", "ACC_PAYROLL", 50000, 70)
    for i in range(1, 23):
        add("ACC_PAYROLL", f"ACC_EMP{i:03d}", 2800 + random.randint(0, 500), 72)

    # Normal random transactions
    random.seed(42)
    normals = [f"ACC_N{i:02d}" for i in range(1, 16)]
    for i in range(35):
        s = random.choice(normals)
        r = random.choice([n for n in normals if n != s])
        add(s, r, random.randint(100, 3000), i * 1.5)

    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df
