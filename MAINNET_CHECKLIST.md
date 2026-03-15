# Mainnet Migration Checklist

## CRITICAL — Do Before Mainnet Launch

### 1. MOTO Live Price Feed (currently hardcoded)
- [ ] Get MotoSwap MOTO/WBTC pool address on mainnet
- [ ] Create `services/price-feed.ts` that queries pool.getReserves() every 1 second
- [ ] Calculate price: `reserveWBTC / reserveMOTO * BTC_USD_price`
- [ ] Replace `config.motoUsdPrice` static value with live feed
- [ ] Broadcast `MOTO_PRICE` to all connected clients on each update
- [ ] Add fallback: if RPC fails, keep last known price (don't reset to 0)
- **Pool ABI**: `MotoswapPoolAbi` from `opnet` package (already available)
- **Method**: `pool.getReserves()` → `{ reserve0, reserve1, blockTimestampLast }`
- **Factory**: Use `factory.getPool(MOTO, WBTC)` to discover pool address

### 2. DEV_MODE
- [ ] Set `DEV_MODE: 'false'` in ecosystem.config.cjs
- [ ] Set real OPERATOR_MNEMONIC (not test mnemonic)
- [ ] Generate fresh SEED_SECRET
- [ ] Set ALLOWED_ORIGIN to real domain

### 3. TLS/HTTPS
- [ ] Configure nginx + Let's Encrypt (conf file at /root/chart-arena/nginx-chart-arena.conf)
- [ ] Update ALLOWED_ORIGIN to https://yourdomain.com

### 4. Network Config
- [ ] Change NETWORK=mainnet in ecosystem.config.cjs
- [ ] Change RPC_URL to https://mainnet.opnet.org
- [ ] Deploy new escrow contract on mainnet and update ESCROW_ADDRESS
- [ ] Update MOTO_TOKEN address if different on mainnet

### 5. Frontend
- [ ] Set VITE_RPC_URL to mainnet
- [ ] Set VITE_ESCROW to mainnet contract address
- [ ] Rebuild frontend: npm run build

### 6. ELO System
- [ ] Not implemented — decide if needed before mainnet
- [ ] Dead code in services/elo.ts + DB tables exist but unused
