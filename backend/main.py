from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import pandas as pd
import io
import time
from graph_engine import GraphEngine

app = FastAPI(title="FinForge API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REQUIRED_COLUMNS = {"transaction_id", "sender_id", "receiver_id", "amount", "timestamp"}


@app.get("/")
def root():
    return {"status": "FinForge API is running", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    contents = await file.read()

    # try utf-8 first, fall back to latin-1
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError:
        text = contents.decode("latin-1")

    try:
        df = pd.read_csv(io.StringIO(text), dtype=str)
        df.columns = [c.strip().lower() for c in df.columns]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {str(e)}")

    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing)}")

    df = df.dropna(subset=["sender_id", "receiver_id"]).copy()
    df.loc[:, "amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0)

    # try common formats explicitly to avoid the dateutil warning
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S"):
        try:
            df.loc[:, "timestamp"] = pd.to_datetime(df["timestamp"], format=fmt, errors="raise")
            break
        except Exception:
            continue
    else:
        # if none matched, fall back silently
        df.loc[:, "timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")

    t0 = time.time()
    engine = GraphEngine(df)
    result = engine.run()
    result["summary"]["processing_time_seconds"] = round(time.time() - t0, 2)

    return JSONResponse(content=result)


@app.post("/sample")
def sample():
    """Generate and analyze a built-in sample dataset."""
    from sample_data import generate_sample_df
    df = generate_sample_df()
    t0 = time.time()
    engine = GraphEngine(df)
    result = engine.run()
    result["summary"]["processing_time_seconds"] = round(time.time() - t0, 2)
    return JSONResponse(content=result)