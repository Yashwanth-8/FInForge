#!/bin/bash
# FinForge - Start both backend and frontend

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  ⬡ FinForge — Financial Crime Detection Engine"
echo "  ─────────────────────────────────────────────"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
  echo "  ✗ python3 not found. Please install Python 3.9+"
  exit 1
fi

# Check Node
if ! command -v node &> /dev/null; then
  echo "  ✗ node not found. Please install Node.js 18+"
  exit 1
fi

# Install backend deps using pip3 or python3 -m pip
echo "  → Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
if command -v pip3 &> /dev/null; then
  pip3 install -r requirements.txt -q 2>/dev/null || pip3 install -r requirements.txt -q --break-system-packages
else
  python3 -m pip install -r requirements.txt -q
fi

# Install frontend deps
echo "  → Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
npm install --silent

echo ""
echo "  ✓ Dependencies ready"
echo ""
echo "  Starting servers:"
echo "    Backend  →  http://localhost:8000"
echo "    Frontend →  http://localhost:5173"
echo ""
echo "  Open http://localhost:5173 in your browser"
echo "  Press Ctrl+C to stop both servers"
echo ""

# Start backend in background (use python3 -m uvicorn so it always works)
cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

# On Ctrl+C, kill both
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo ''; echo '  Servers stopped.'; exit" INT
wait
