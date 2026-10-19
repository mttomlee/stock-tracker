# Stockroom

A stock watchlist and chart dashboard, with live market data from Yahoo Finance.

## Run locally

1. Install the web dependencies with `npm install`.
2. Install the Python backend dependencies:

   ```powershell
   python -m pip install -r backend\requirements.txt
   ```

3. Start both servers together:

   ```powershell
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000). The API is available at [http://localhost:8000/docs](http://localhost:8000/docs). Press Ctrl+C to stop both servers.

The backend provides watchlist quotes and edits, OHLC history with EMA overlays, and a SOXX-versus-Nasdaq peak comparison. Yahoo Finance is an external data source; quotes can be delayed or unavailable. The default watchlist is held in memory and resets when the API server restarts.

To run the backend unit tests, use `python -m unittest backend.test_main`.
