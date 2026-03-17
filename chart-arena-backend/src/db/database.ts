import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import type { MatchLog, PlayerMatchResult } from '../game/types.js';
import { logger } from '../utils/logger.js';

const TAG = 'Database';
const DB_PATH = resolve('./data/chart-arena.db');

class AppDatabase {
    private _db: Database.Database | null = null;

    public init(): void {
        mkdirSync(resolve('./data'), { recursive: true });
        this._db = new Database(DB_PATH);
        this._db.pragma('journal_mode = WAL');
        this._db.pragma('foreign_keys = ON');
        this.createTables();
        this.runMigrations();
        logger.info(TAG, `Database ready at ${DB_PATH}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // EXISTING METHODS (unchanged)
    // ═══════════════════════════════════════════════════════════════

    public storeMatchLog(log: MatchLog): void {
        const stmt = this.db.prepare(`
            INSERT INTO match_logs (match_id, seed, mode, format, buy_in, players,
                candles, trades, standings, payouts, timestamp, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            log.matchId, log.seed, log.mode, log.format, log.buyIn,
            JSON.stringify(log.players), JSON.stringify(log.priceTicks),
            JSON.stringify(log.trades), JSON.stringify(log.standings),
            JSON.stringify(log.payouts), log.timestamp, JSON.stringify(log),
        );
    }

    public getMatchLog(matchId: string): MatchLog | null {
        const stmt = this.db.prepare('SELECT raw_json FROM match_logs WHERE match_id = ?');
        const row = stmt.get(matchId) as { raw_json: string } | undefined;
        return row ? (JSON.parse(row.raw_json) as MatchLog) : null;
    }

    public updatePlayerStats(address: string, won: boolean, earnings: string, rank: number, volume: string = '0'): void {
        const stmt = this.db.prepare(`
            INSERT INTO player_stats (address, matches_played, wins, losses, total_earnings, best_rank, total_volume, current_win_streak, best_win_streak)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
                matches_played = matches_played + 1,
                wins = wins + ?, losses = losses + ?,
                total_earnings = CAST((CAST(total_earnings AS REAL) + CAST(? AS REAL)) AS TEXT),
                best_rank = MIN(best_rank, ?),
                total_volume = CAST((CAST(total_volume AS INTEGER) + CAST(? AS INTEGER)) AS TEXT),
                current_win_streak = CASE WHEN ? = 1 THEN current_win_streak + 1 ELSE 0 END,
                best_win_streak = MAX(best_win_streak, CASE WHEN ? = 1 THEN current_win_streak + 1 ELSE best_win_streak END)
        `);
        const w = won ? 1 : 0;
        stmt.run(address, w, won ? 0 : 1, earnings, rank, volume, w, w,
                  w, won ? 0 : 1, earnings, rank, volume, w, w);
    }

    public getPlayerStats(address: string): PlayerStats | null {
        const stmt = this.db.prepare('SELECT * FROM player_stats WHERE address = ?');
        return (stmt.get(address) as PlayerStats) ?? null;
    }

    // ═══ Per-Mode Stats (Sprint 2) ═══

    public updatePlayerModeStats(address: string, result: PlayerMatchResult, earnings: string, volume: string): void {
        const w = result.won ? 1 : 0;
        const mode = result.mode;

        // ── Upsert universal fields ──
        this.db.prepare(`
            INSERT INTO player_mode_stats (
                address, mode, matches_played, wins, losses, total_volume, total_earnings,
                best_rank, current_win_streak, best_win_streak,
                total_trades, total_items_used, total_items_received, total_position_ticks
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(address, mode) DO UPDATE SET
                matches_played = matches_played + 1,
                wins = wins + ?,
                losses = losses + ?,
                total_volume = CAST((CAST(total_volume AS INTEGER) + CAST(? AS INTEGER)) AS TEXT),
                total_earnings = CAST((CAST(total_earnings AS REAL) + CAST(? AS REAL)) AS TEXT),
                best_rank = MIN(best_rank, ?),
                current_win_streak = CASE WHEN ? = 1 THEN current_win_streak + 1 ELSE 0 END,
                best_win_streak = MAX(best_win_streak, CASE WHEN ? = 1 THEN current_win_streak + 1 ELSE best_win_streak END),
                total_trades = total_trades + ?,
                total_items_used = total_items_used + ?,
                total_items_received = total_items_received + ?,
                total_position_ticks = total_position_ticks + ?
        `).run(
            // INSERT values
            address, mode, w, w ? 0 : 1, volume, earnings,
            result.rank, w, w,
            result.tradesExecuted, result.itemsUsed, result.itemsReceived, result.positionTicks,
            // UPDATE values
            w, w ? 0 : 1, volume, earnings, result.rank, w, w,
            result.tradesExecuted, result.itemsUsed, result.itemsReceived, result.positionTicks,
        );

        // ── Mode-specific field updates ──

        // Classic: trade limit tracking
        if (mode === 0 && result.classicTradesOfLimit > 0) {
            this.db.prepare(`
                UPDATE player_mode_stats SET
                    total_trades_of_limit = total_trades_of_limit + ?,
                    perfect_reads = perfect_reads + CASE WHEN ? = 1 AND ? <= 4 THEN 1 ELSE 0 END,
                    one_trade_wins = one_trade_wins + CASE WHEN ? = 1 AND ? = 1 THEN 1 ELSE 0 END,
                    full_trade_wins = full_trade_wins + CASE WHEN ? = 1 AND ? = 8 THEN 1 ELSE 0 END
                WHERE address = ? AND mode = 0
            `).run(
                result.classicTradesOfLimit,
                w, result.classicTradesOfLimit,
                w, result.classicTradesOfLimit,
                w, result.classicTradesOfLimit,
                address,
            );
        }

        // Survival: survival tracking
        if (mode === 1) {
            const survTick = result.survivalSurvivedUntilTick;
            this.db.prepare(`
                UPDATE player_mode_stats SET
                    best_survival_tick = MAX(best_survival_tick, ?),
                    survived_past_200_count = survived_past_200_count + CASE WHEN ? >= 200 THEN 1 ELSE 0 END,
                    no_items_wins = no_items_wins + CASE WHEN ? = 1 AND ? = 0 THEN 1 ELSE 0 END
                WHERE address = ? AND mode = 1
            `).run(survTick, survTick, w, result.itemsUsed, address);
        }

        // Chaos: mutator tracking
        if (mode === 2) {
            // Update items_used_single_match_best
            this.db.prepare(`
                UPDATE player_mode_stats SET
                    items_used_single_match_best = MAX(items_used_single_match_best, ?),
                    total_mutators_experienced = total_mutators_experienced + ?
                WHERE address = ? AND mode = 2
            `).run(result.itemsUsed, result.chaosMutatorsExperienced.length, address);

            // Merge unique_mutators_seen JSON
            if (result.chaosMutatorsExperienced.length > 0) {
                const row = this.db.prepare(
                    'SELECT unique_mutators_seen FROM player_mode_stats WHERE address = ? AND mode = 2'
                ).get(address) as { unique_mutators_seen: string } | undefined;
                const existing: string[] = row ? JSON.parse(row.unique_mutators_seen) : [];
                const merged = [...new Set([...existing, ...result.chaosMutatorsExperienced])];
                this.db.prepare(
                    'UPDATE player_mode_stats SET unique_mutators_seen = ? WHERE address = ? AND mode = 2'
                ).run(JSON.stringify(merged), address);
            }

            // Track chaos multiplier wins
            if (result.won && result.chaosMultiplier !== 1.0) {
                this.db.prepare(`
                    UPDATE player_mode_stats SET
                        best_chaos_multiplier_win = CASE WHEN ? > best_chaos_multiplier_win THEN ? ELSE best_chaos_multiplier_win END,
                        worst_chaos_multiplier_win = CASE WHEN ? < worst_chaos_multiplier_win THEN ? ELSE worst_chaos_multiplier_win END
                    WHERE address = ? AND mode = 2
                `).run(
                    result.chaosMultiplier, result.chaosMultiplier,
                    result.chaosMultiplier, result.chaosMultiplier,
                    address,
                );
            }
        }

        logger.debug(TAG, `Mode stats updated: ${address.slice(0, 8)} mode=${mode} won=${result.won}`);
    }

    public getPlayerModeStats(address: string, mode: number): PlayerModeStats | null {
        return (this.db.prepare(
            'SELECT * FROM player_mode_stats WHERE address = ? AND mode = ?'
        ).get(address, mode) as PlayerModeStats) ?? null;
    }

    public getAllPlayerModeStats(address: string): PlayerModeStats[] {
        return this.db.prepare(
            'SELECT * FROM player_mode_stats WHERE address = ? ORDER BY mode'
        ).all(address) as PlayerModeStats[];
    }

    public getTopByEarnings(limit: number = 10): Array<{ address: string; value: string }> {
        return this.db.prepare(
            'SELECT address, total_earnings as value FROM player_stats ORDER BY CAST(total_earnings AS REAL) DESC LIMIT ?'
        ).all(limit) as Array<{ address: string; value: string }>;
    }

    public getTopByVolume(limit: number = 10): Array<{ address: string; value: string }> {
        return this.db.prepare(
            'SELECT address, total_volume as value FROM player_stats ORDER BY CAST(total_volume AS INTEGER) DESC LIMIT ?'
        ).all(limit) as Array<{ address: string; value: string }>;
    }

    public getTopByWins(limit: number = 10): Array<{ address: string; value: number }> {
        return this.db.prepare(
            'SELECT address, wins as value FROM player_stats ORDER BY wins DESC LIMIT ?'
        ).all(limit) as Array<{ address: string; value: number }>;
    }

    public getRecentMatches(limit: number = 20): MatchLog[] {
        const stmt = this.db.prepare('SELECT raw_json FROM match_logs ORDER BY timestamp DESC LIMIT ?');
        const rows = stmt.all(limit) as Array<{ raw_json: string }>;
        return rows.map((r) => JSON.parse(r.raw_json) as MatchLog);
    }

    /**
     * DEAD-05 FIX: Count matches played by a player since a given timestamp.
     * Used for per-season match counting (season rewards require MIN_MATCHES).
     */
    public countPlayerMatchesSince(address: string, sinceTimestamp: number): number {
        const escaped = address.replace(/[%_\\]/g, '\\$&');
        const row = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM match_logs
            WHERE players LIKE ? ESCAPE '\\' AND timestamp >= ?
        `).get(`%${escaped}%`, sinceTimestamp) as { cnt: number };
        return row.cnt;
    }

    public getPlayerMatchHistory(address: string, limit: number = 30): BattleLogEntry[] {
        // NEW-6 FIX: Escape LIKE wildcards in address
        const escaped = address.replace(/[%_\\]/g, '\\$&');
        const stmt = this.db.prepare(`
            SELECT match_id, mode, format, buy_in, players, standings, timestamp
            FROM match_logs WHERE players LIKE ? ESCAPE '\' ORDER BY timestamp DESC LIMIT ?
        `);
        const rows = stmt.all(`%${escaped}%`, limit) as Array<{
            match_id: string; mode: number; format: number; buy_in: string;
            players: string; standings: string; timestamp: number;
        }>;
        return rows.map((row) => {
            const players: string[] = JSON.parse(row.players);
            const standings: Array<{ address: string; rank: number; finalEquity: number }> = JSON.parse(row.standings);
            const playerStanding = standings.find(s => s.address === address);
            return {
                matchId: row.match_id, mode: row.mode, format: row.format,
                buyIn: row.buy_in, playerCount: players.length,
                rank: playerStanding?.rank ?? 0, finalEquity: playerStanding?.finalEquity ?? 0,
                timestamp: row.timestamp,
            };
        });
    }

    // ── Player Profiles (unchanged) ──

    // ── Bug 4.5: Settled Matches Persistence ──

    public addSettledMatch(matchId: string, txHash: string): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO settled_matches (match_id, tx_hash) VALUES (?, ?)
        `);
        stmt.run(matchId, txHash);
    }

    public getSettledMatchIds(): string[] {
        const stmt = this.db.prepare('SELECT match_id FROM settled_matches');
        const rows = stmt.all() as Array<{ match_id: string }>;
        return rows.map(r => r.match_id);
    }

    public isMatchSettled(matchId: string): boolean {
        const stmt = this.db.prepare('SELECT 1 FROM settled_matches WHERE match_id = ?');
        return !!stmt.get(matchId);
    }

    /** NEW-7 FIX: Find matches stuck with txHash='pending' after a crash */
    public getPendingSettlements(): string[] {
        const stmt = this.db.prepare("SELECT match_id FROM settled_matches WHERE tx_hash = 'pending'");
        const rows = stmt.all() as Array<{ match_id: string }>;
        return rows.map(r => r.match_id);
    }

    // ── P0 FIX: Double-deposit prevention ──

    /** Check if a transfer TX has already been credited */
    public isDepositProcessed(txHash: string): boolean {
        const row = this.db.prepare(
            'SELECT 1 FROM processed_deposits WHERE tx_hash = ?'
        ).get(txHash);
        return !!row;
    }

    /** Mark a transfer TX as processed (prevents replay) */
    public markDepositProcessed(txHash: string, playerAddress: string, amount: string): void {
        this.db.prepare(
            'INSERT OR IGNORE INTO processed_deposits (tx_hash, player_address, amount) VALUES (?, ?, ?)'
        ).run(txHash, playerAddress, amount);
    }

    /** Get deposit history for a player (admin/debug) */
    public getPlayerDeposits(playerAddress: string, limit: number = 20): Array<{
        tx_hash: string; amount: string; credited_at: number;
    }> {
        return this.db.prepare(
            'SELECT tx_hash, amount, credited_at FROM processed_deposits WHERE player_address = ? ORDER BY credited_at DESC LIMIT ?'
        ).all(playerAddress, limit) as Array<{ tx_hash: string; amount: string; credited_at: number }>;
    }

    // ── SPRINT 2 FIX: Off-chain escrow ledger ──
    // Tracks balance changes INSTANTLY (no waiting for block confirmation).
    // Types: 'deposit' | 'match_debit' | 'match_payout' | 'withdraw'
    // C-03 FIX: Added 'status' field — 'confirmed' (default) or 'pending'.
    //           Pending payouts are recorded at settlement broadcast, confirmed after TX confirmation.

    /** Record a balance change in the off-chain ledger.
     *  C-03: status defaults to 'confirmed'. Settlement payouts use 'pending' until TX confirms.
     */
    public recordEscrowChange(address: string, amount: string, type: string, matchId?: string, txHash?: string, status: string = 'confirmed'): void {
        this.db.prepare(
            'INSERT INTO escrow_ledger (address, amount, type, match_id, tx_hash, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(address, amount, type, matchId ?? null, txHash ?? null, status);
    }

    /**
     * M-01 FIX: Get off-chain escrow balance using JS BigInt summation.
     * Old code used CAST(amount AS INTEGER) which overflows at ~9.2 MOTO (9.2e18 wei).
     * C-03 FIX: Only counts 'confirmed' entries (excludes 'pending' payouts).
     */
    public getOffchainEscrowBalance(address: string): bigint {
        const rows = this.db.prepare(
            "SELECT amount FROM escrow_ledger WHERE address = ? AND status = 'confirmed'"
        ).all(address) as { amount: string }[];
        return rows.reduce((sum, r) => {
            try { return sum + BigInt(r.amount); }
            catch { return sum; } // skip malformed entries
        }, 0n);
    }

    /**
     * C-03: Get display balance INCLUDING pending payouts (for UI "available + pending" display).
     * Players see their pending winnings but can't queue with them until confirmed.
     */
    public getOffchainDisplayBalance(address: string): { confirmed: bigint; pending: bigint } {
        const rows = this.db.prepare(
            'SELECT amount, status FROM escrow_ledger WHERE address = ?'
        ).all(address) as { amount: string; status: string }[];
        let confirmed = 0n;
        let pending = 0n;
        for (const r of rows) {
            try {
                const amt = BigInt(r.amount);
                if (r.status === 'pending') pending += amt;
                else confirmed += amt;
            } catch { /* skip malformed */ }
        }
        return { confirmed, pending };
    }

    /**
     * C-03: Confirm pending payouts after TX is mined.
     * Called by the settlement confirmation poller.
     */
    public confirmPendingPayouts(txHash: string): number {
        const result = this.db.prepare(
            "UPDATE escrow_ledger SET status = 'confirmed' WHERE tx_hash = ? AND status = 'pending'"
        ).run(txHash);
        return result.changes;
    }

    /**
     * C-03: Get all unique TX hashes that have pending entries (for the confirmation poller).
     */
    public getPendingPayoutTxHashes(): string[] {
        const rows = this.db.prepare(
            "SELECT DISTINCT tx_hash FROM escrow_ledger WHERE status = 'pending' AND tx_hash IS NOT NULL"
        ).all() as { tx_hash: string }[];
        return rows.map(r => r.tx_hash);
    }

    /** Get escrow ledger history for a player (admin/debug) */
    public getEscrowLedger(address: string, limit: number = 50): Array<{
        amount: string; type: string; match_id: string | null; tx_hash: string | null; created_at: number;
    }> {
        return this.db.prepare(
            'SELECT amount, type, match_id, tx_hash, created_at FROM escrow_ledger WHERE address = ? ORDER BY created_at DESC LIMIT ?'
        ).all(address, limit) as Array<{ amount: string; type: string; match_id: string | null; tx_hash: string | null; created_at: number }>;
    }

    public getProfile(address: string): PlayerProfile | null {
        const stmt = this.db.prepare('SELECT * FROM player_profiles WHERE address = ?');
        return (stmt.get(address) as PlayerProfile) ?? null;
    }

    public isUsernameTaken(username: string): boolean {
        const stmt = this.db.prepare('SELECT 1 FROM player_profiles WHERE username = ? COLLATE NOCASE');
        return !!stmt.get(username);
    }

    public setProfile(address: string, username: string, twitterHandle?: string): boolean {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO player_profiles (address, username, twitter_handle)
                VALUES (?, ?, ?)
                ON CONFLICT(address) DO UPDATE SET
                    username = excluded.username, twitter_handle = excluded.twitter_handle
            `);
            stmt.run(address, username, twitterHandle ?? null);
            return true;
        } catch (err) {
            logger.warn(TAG, `Failed to set profile for ${address}`, err);
            return false;
        }
    }

    public getDisplayName(address: string): string | null {
        const stmt = this.db.prepare('SELECT username FROM player_profiles WHERE address = ?');
        const row = stmt.get(address) as { username: string } | undefined;
        return row?.username ?? null;
    }

    public getDisplayNames(addresses: string[]): Map<string, string> {
        const map = new Map<string, string>();
        if (addresses.length === 0) return map;
        const placeholders = addresses.map(() => '?').join(',');
        const stmt = this.db.prepare(`SELECT address, username FROM player_profiles WHERE address IN (${placeholders})`);
        const rows = stmt.all(...addresses) as Array<{ address: string; username: string }>;
        for (const row of rows) map.set(row.address, row.username);
        return map;
    }

    // ── Quests (kept for milestones) ──

    public getCompletedQuests(address: string): Set<string> {
        const stmt = this.db.prepare('SELECT quest_id FROM player_quests WHERE address = ?');
        const rows = stmt.all(address) as Array<{ quest_id: string }>;
        return new Set(rows.map(r => r.quest_id));
    }

    /**
     * Get total quest points earned by a player (sum of all completed quests).
     */
    public getQuestPointsTotal(address: string): number {
        const row = this.db.prepare(
            'SELECT COALESCE(SUM(points_earned), 0) as total FROM player_quests WHERE address = ?'
        ).get(address) as { total: number };
        return row.total;
    }

    public completeQuest(address: string, questId: string, points: number): void {
        const insertQuest = this.db.prepare(`
            INSERT OR IGNORE INTO player_quests (address, quest_id, points_earned) VALUES (?, ?, ?)
        `);
        const tx = this.db.transaction(() => {
            const result = insertQuest.run(address, questId, points);
            if (result.changes > 0) {
                // Milestones go to the appropriate pillar
                // Play/win/streak milestones → engagement, special → skill
                const pillar = questId.startsWith('play_') || questId.startsWith('win_') ? 'engagement' : 'skill';
                if (pillar === 'engagement') {
                    this.addPointsByPillar(address, points, 0, `milestone_${questId}`);
                } else {
                    this.addPointsByPillar(address, 0, points, `milestone_${questId}`);
                }
            }
        });
        tx();
    }

    /** @deprecated — Use getPointsByPillar() instead for the new system */
    public getPlayerPoints(address: string): number {
        const pillars = this.getPointsByPillar(address);
        return pillars.engagement + pillars.skill + pillars.volume + pillars.community;
    }

    // ── Referral System (existing, kept) ──

    public getOrCreateReferralCode(address: string): string {
        const existing = this.db.prepare('SELECT code FROM referral_links WHERE address = ?')
            .get(address) as { code: string } | undefined;
        if (existing) return existing.code;
        const code = address.slice(0, 12);
        this.db.prepare('INSERT OR IGNORE INTO referral_links (address, code) VALUES (?, ?)').run(address, code);
        return code;
    }

    public resolveReferralCode(code: string): string | null {
        const row = this.db.prepare('SELECT address FROM referral_links WHERE code = ?')
            .get(code) as { address: string } | undefined;
        return row?.address ?? null;
    }

    public applyReferral(referredAddress: string, referrerAddress: string): boolean {
        if (referredAddress === referrerAddress) return false;
        const existing = this.db.prepare('SELECT 1 FROM referral_claims WHERE referred_address = ?').get(referredAddress);
        if (existing) return false;

        const tx = this.db.transaction(() => {
            this.db.prepare('INSERT INTO referral_claims (referrer_address, referred_address) VALUES (?, ?)')
                .run(referrerAddress, referredAddress);
            this.db.prepare('UPDATE referral_links SET total_referrals = total_referrals + 1 WHERE address = ?')
                .run(referrerAddress);
        });
        tx();
        return true;
    }

    public creditReferralBonus(referredAddress: string, earnedPoints: number): void {
        // Kept for backward compat but now capped via points-engine
        const row = this.db.prepare('SELECT referrer_address FROM referral_claims WHERE referred_address = ?')
            .get(referredAddress) as { referrer_address: string } | undefined;
        if (!row) return;
        const bonus = Math.floor(earnedPoints * 0.05);
        if (bonus <= 0) return;
        this.addPointsByPillar(row.referrer_address, 0, 0, 'referral_bonus', 0, bonus);
    }

    public getReferralStats(address: string): ReferralStats {
        const code = this.getOrCreateReferralCode(address);
        const linkRow = this.db.prepare('SELECT total_referrals, total_bonus_points FROM referral_links WHERE address = ?')
            .get(address) as { total_referrals: number; total_bonus_points: number } | undefined;
        const referredRows = this.db.prepare(`
            SELECT rc.referred_address, pp.username
            FROM referral_claims rc LEFT JOIN player_profiles pp ON pp.address = rc.referred_address
            WHERE rc.referrer_address = ? ORDER BY rc.claimed_at DESC LIMIT 50
        `).all(address) as Array<{ referred_address: string; username: string | null }>;
        const myReferrer = this.db.prepare('SELECT referrer_address FROM referral_claims WHERE referred_address = ?')
            .get(address) as { referrer_address: string } | undefined;

        return {
            code, referralUrl: `https://chart-arena.online/?ref=${code}`,
            totalReferrals: linkRow?.total_referrals ?? 0,
            totalBonusPoints: linkRow?.total_bonus_points ?? 0,
            referredPlayers: referredRows.map(r => ({
                address: r.referred_address,
                displayName: r.username ?? r.referred_address.slice(0, 8) + '…',
            })),
            hasReferrer: !!myReferrer,
        };
    }

    public getReferrer(address: string): string | null {
        const row = this.db.prepare('SELECT referrer_address FROM referral_claims WHERE referred_address = ?')
            .get(address) as { referrer_address: string } | undefined;
        return row?.referrer_address ?? null;
    }

    public markReferralPlayed(address: string): void {
        this.db.prepare('UPDATE referral_claims SET has_played = 1 WHERE referred_address = ?').run(address);
    }

    /** @deprecated — Use addPointsByPillar() instead */
    public addPoints(address: string, points: number): void {
        this.addPointsByPillar(address, points, 0, 'legacy');
    }

    public addReferralVolume(referrerAddress: string, referredAddress: string, volumeRaw: string): void {
        this.db.prepare(`
            UPDATE referral_claims
            SET referral_volume = CAST((CAST(referral_volume AS INTEGER) + CAST(? AS INTEGER)) AS TEXT)
            WHERE referred_address = ?
        `).run(volumeRaw, referredAddress);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: 4-PILLAR POINTS SYSTEM
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get points broken down by pillar.
     */
    public getPointsByPillar(address: string): PillarPoints {
        const row = this.db.prepare('SELECT * FROM player_points_v2 WHERE address = ?')
            .get(address) as PillarPointsRow | undefined;
        return {
            engagement: row?.engagement_pts ?? 0,
            skill: row?.skill_pts ?? 0,
            volume: row?.volume_pts ?? 0,
            community: row?.community_pts ?? 0,
        };
    }

    /**
     * Add points to specific pillars. This is the central point-writing method.
     */
    public addPointsByPillar(
        address: string,
        engagement: number,
        skill: number,
        source: string,
        volume?: number,
        community?: number,
    ): void {
        const vol = volume ?? 0;
        const comm = community ?? 0;

        this.db.prepare(`
            INSERT INTO player_points_v2 (address, engagement_pts, skill_pts, volume_pts, community_pts)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
                engagement_pts = engagement_pts + ?,
                skill_pts = skill_pts + ?,
                volume_pts = volume_pts + ?,
                community_pts = community_pts + ?
        `).run(address, engagement, skill, vol, comm,
               engagement, skill, vol, comm);

        // Also update legacy total_points for backward compat
        const total = engagement + skill + vol + comm;
        if (total > 0) {
            this.db.prepare(`
                INSERT INTO player_points (address, total_points) VALUES (?, ?)
                ON CONFLICT(address) DO UPDATE SET total_points = total_points + ?
            `).run(address, total, total);
        }

        // Log the point event
        this.db.prepare(`
            INSERT INTO point_events (address, source, engagement, skill, volume, community)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(address, source, engagement, skill, vol, comm);
    }

    /**
     * Set volume points (idempotent — overwrites previous value).
     */
    public setVolumePoints(address: string, volumePts: number): void {
        const current = this.getPointsByPillar(address);
        const delta = volumePts - current.volume;
        if (delta === 0) return;

        this.db.prepare(`
            INSERT INTO player_points_v2 (address, engagement_pts, skill_pts, volume_pts, community_pts)
            VALUES (?, 0, 0, ?, 0)
            ON CONFLICT(address) DO UPDATE SET volume_pts = ?
        `).run(address, volumePts, volumePts);

        // Update legacy total
        if (delta !== 0) {
            this.db.prepare(`
                INSERT INTO player_points (address, total_points) VALUES (?, ?)
                ON CONFLICT(address) DO UPDATE SET total_points = total_points + ?
            `).run(address, Math.max(0, delta), delta);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: DAILY ACTIVITY
    // ═══════════════════════════════════════════════════════════════

    public getDailyActivity(address: string, date: string): DailyActivityRow | null {
        return this.db.prepare('SELECT * FROM daily_activity WHERE address = ? AND date = ?')
            .get(address, date) as DailyActivityRow | undefined ?? null;
    }

    public createDailyActivity(address: string, date: string): void {
        this.db.prepare(`
            INSERT OR IGNORE INTO daily_activity (address, date, matches_played, wins, points_earned)
            VALUES (?, ?, 0, 0, 0)
        `).run(address, date);
    }

    public updateDailyActivity(address: string, date: string, matches: number, wins: number, pointsEarned: number): void {
        this.db.prepare(`
            UPDATE daily_activity SET matches_played = ?, wins = ?, points_earned = ?
            WHERE address = ? AND date = ?
        `).run(matches, wins, pointsEarned, address, date);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: LOGIN STREAKS
    // ═══════════════════════════════════════════════════════════════

    public getLoginStreak(address: string): LoginStreakRow | null {
        return this.db.prepare('SELECT * FROM login_streaks WHERE address = ?')
            .get(address) as LoginStreakRow | undefined ?? null;
    }

    /**
     * Update login streak. If last_active_date was yesterday, increment.
     * If it was today, no-op. If older, reset to 1.
     */
    public touchLoginStreak(address: string, todayDate: string): void {
        const existing = this.getLoginStreak(address);

        if (!existing) {
            this.db.prepare(`
                INSERT INTO login_streaks (address, current_streak, best_streak, last_active_date)
                VALUES (?, 1, 1, ?)
            `).run(address, todayDate);
            return;
        }

        if (existing.last_active_date === todayDate) return; // Already counted today

        // Check if last active was yesterday
        const lastDate = new Date(existing.last_active_date + 'T00:00:00Z');
        const today = new Date(todayDate + 'T00:00:00Z');
        const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

        let newStreak: number;
        if (diffDays === 1) {
            newStreak = existing.current_streak + 1;
        } else {
            newStreak = 1; // Reset
        }

        const bestStreak = Math.max(existing.best_streak, newStreak);

        this.db.prepare(`
            UPDATE login_streaks SET current_streak = ?, best_streak = ?, last_active_date = ?
            WHERE address = ?
        `).run(newStreak, bestStreak, todayDate, address);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: WIN STREAK BONUSES
    // ═══════════════════════════════════════════════════════════════

    public hasStreakBonusBeenAwarded(address: string, streak: number): boolean {
        const row = this.db.prepare(
            'SELECT 1 FROM streak_bonuses_awarded WHERE address = ? AND streak_threshold = ?'
        ).get(address, streak);
        return !!row;
    }

    public markStreakBonusAwarded(address: string, streak: number): void {
        this.db.prepare(`
            INSERT OR IGNORE INTO streak_bonuses_awarded (address, streak_threshold) VALUES (?, ?)
        `).run(address, streak);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: ELO RATINGS
    // ═══════════════════════════════════════════════════════════════

    public getEloRating(address: string): EloRow | null {
        return this.db.prepare('SELECT * FROM elo_ratings WHERE address = ?')
            .get(address) as EloRow | undefined ?? null;
    }

    public upsertEloRating(address: string, elo: number): void {
        this.db.prepare(`
            INSERT INTO elo_ratings (address, elo) VALUES (?, ?)
            ON CONFLICT(address) DO UPDATE SET elo = ?, updated_at = (unixepoch())
        `).run(address, elo, elo);
    }

    public getEloLeaderboard(limit: number = 50): Array<{ address: string; elo: number; rank: number }> {
        const rows = this.db.prepare(`
            SELECT address, elo, ROW_NUMBER() OVER (ORDER BY elo DESC) as rank
            FROM elo_ratings ORDER BY elo DESC LIMIT ?
        `).all(limit) as Array<{ address: string; elo: number; rank: number }>;
        return rows;
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: SEASONS
    // ═══════════════════════════════════════════════════════════════

    public getCurrentSeason(): SeasonRow | null {
        return this.db.prepare(
            "SELECT * FROM seasons WHERE ended = 0 ORDER BY season_id DESC LIMIT 1"
        ).get() as SeasonRow | undefined ?? null;
    }

    public getLastSeason(): SeasonRow | null {
        return this.db.prepare(
            "SELECT * FROM seasons ORDER BY season_id DESC LIMIT 1"
        ).get() as SeasonRow | undefined ?? null;
    }

    public createSeason(seasonId: number, startDate: string, endDate: string): void {
        this.db.prepare(`
            INSERT INTO seasons (season_id, start_date, end_date, ended) VALUES (?, ?, ?, 0)
        `).run(seasonId, startDate, endDate);
    }

    public endSeason(seasonId: number): void {
        this.db.prepare('UPDATE seasons SET ended = 1 WHERE season_id = ?').run(seasonId);
    }

    public snapshotSeason(seasonId: number, leaderboard: Array<{ address: string; elo: number; rank: number }>): void {
        const stmt = this.db.prepare(`
            INSERT INTO season_snapshots (season_id, address, elo, rank, engagement_pts, skill_pts, volume_pts, community_pts)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const tx = this.db.transaction(() => {
            for (const entry of leaderboard) {
                const pillars = this.getPointsByPillar(entry.address);
                stmt.run(seasonId, entry.address, entry.elo, entry.rank,
                         pillars.engagement, pillars.skill, pillars.volume, pillars.community);
            }
        });
        tx();
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: REFERRAL POINT CAPS
    // ═══════════════════════════════════════════════════════════════

    public getReferralPointStats(referrerAddress: string): { activeReferrals: number; lifetimePoints: number } {
        const countRow = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM referral_claims WHERE referrer_address = ?'
        ).get(referrerAddress) as { cnt: number };

        const ptsRow = this.db.prepare(
            'SELECT COALESCE(SUM(points), 0) as total FROM referral_points_tracking WHERE referrer_address = ?'
        ).get(referrerAddress) as { total: number };

        return { activeReferrals: countRow.cnt, lifetimePoints: ptsRow.total };
    }

    public getReferralPointsForReferred(referrerAddress: string, referredAddress: string): number {
        const row = this.db.prepare(
            'SELECT COALESCE(points, 0) as pts FROM referral_points_tracking WHERE referrer_address = ? AND referred_address = ?'
        ).get(referrerAddress, referredAddress) as { pts: number } | undefined;
        return row?.pts ?? 0;
    }

    public addReferralPointsTracking(referrerAddress: string, referredAddress: string, points: number): void {
        this.db.prepare(`
            INSERT INTO referral_points_tracking (referrer_address, referred_address, points)
            VALUES (?, ?, ?)
            ON CONFLICT(referrer_address, referred_address) DO UPDATE SET points = points + ?
        `).run(referrerAddress, referredAddress, points, points);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: INACTIVITY DECAY
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get players whose last activity was before the cutoff date.
     */
    public getInactivePlayers(cutoffDate: string): Array<{ address: string }> {
        return this.db.prepare(`
            SELECT ls.address FROM login_streaks ls
            WHERE ls.last_active_date < ?
            AND EXISTS (SELECT 1 FROM player_points_v2 pv WHERE pv.address = ls.address
                        AND (pv.engagement_pts + pv.skill_pts + pv.volume_pts + pv.community_pts) > 0)
        `).all(cutoffDate) as Array<{ address: string }>;
    }

    public getTotalDecay(address: string): number {
        const row = this.db.prepare(
            'SELECT COALESCE(SUM(decay_amount), 0) as total FROM point_decay_log WHERE address = ?'
        ).get(address) as { total: number };
        return row.total;
    }

    public applyDecay(address: string, eng: number, skill: number, vol: number, comm: number): void {
        this.db.prepare(`
            UPDATE player_points_v2 SET
                engagement_pts = MAX(0, engagement_pts - ?),
                skill_pts = MAX(0, skill_pts - ?),
                volume_pts = MAX(0, volume_pts - ?),
                community_pts = MAX(0, community_pts - ?)
            WHERE address = ?
        `).run(eng, skill, vol, comm, address);

        // Update legacy table too
        const total = eng + skill + vol + comm;
        this.db.prepare(`
            UPDATE player_points SET total_points = MAX(0, total_points - ?) WHERE address = ?
        `).run(total, address);
    }

    public logDecay(address: string, amount: number): void {
        this.db.prepare(`
            INSERT INTO point_decay_log (address, decay_amount) VALUES (?, ?)
        `).run(address, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    // SESSION TOKENS (L-01: persist across restarts)
    // ═══════════════════════════════════════════════════════════════

    /** Store a session token. Replaces any existing token for the same address. */
    public storeSessionToken(token: string, address: string, createdAt: number): void {
        this.db.prepare('DELETE FROM session_tokens WHERE address = ?').run(address);
        this.db.prepare('INSERT INTO session_tokens (token, address, created_at) VALUES (?, ?, ?)').run(token, address, createdAt);
    }

    /** Look up a session token. Returns address + createdAt, or null. */
    public getSessionToken(token: string): { address: string; createdAt: number } | null {
        const row = this.db.prepare('SELECT address, created_at FROM session_tokens WHERE token = ?').get(token) as { address: string; created_at: number } | undefined;
        return row ? { address: row.address, createdAt: row.created_at } : null;
    }

    /** Delete a specific token. */
    public deleteSessionToken(token: string): void {
        this.db.prepare('DELETE FROM session_tokens WHERE token = ?').run(token);
    }

    /** Delete all tokens for an address. */
    public deleteSessionTokensByAddress(address: string): void {
        this.db.prepare('DELETE FROM session_tokens WHERE address = ?').run(address);
    }

    /** Load all non-expired tokens into memory. */
    public loadAllSessionTokens(maxAgeMs: number): Array<{ token: string; address: string; createdAt: number }> {
        const cutoff = Date.now() - maxAgeMs;
        // Clean expired tokens
        this.db.prepare('DELETE FROM session_tokens WHERE created_at < ?').run(cutoff);
        const rows = this.db.prepare('SELECT token, address, created_at FROM session_tokens').all() as Array<{ token: string; address: string; created_at: number }>;
        return rows.map(r => ({ token: r.token, address: r.address, createdAt: r.created_at }));
    }

    // ═══════════════════════════════════════════════════════════════
    // H-01 FIX: KNOWN PUBKEYS (first-seen pubkey pinning)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get the stored pubkey for an address. Returns null if never seen.
     */
    public getKnownPubkey(address: string): string | null {
        const row = this.db.prepare(
            'SELECT pubkey_hex FROM known_pubkeys WHERE address = ?'
        ).get(address) as { pubkey_hex: string } | undefined;
        return row?.pubkey_hex ?? null;
    }

    /**
     * Store a pubkey for an address. INSERT OR IGNORE — first write wins.
     * Returns true if this was a new entry, false if already existed.
     */
    public setKnownPubkey(address: string, pubkeyHex: string, source: string = 'first_auth'): boolean {
        const result = this.db.prepare(
            'INSERT OR IGNORE INTO known_pubkeys (address, pubkey_hex, source) VALUES (?, ?, ?)'
        ).run(address, pubkeyHex, source);
        return result.changes > 0;
    }

    /**
     * Update the stored pubkey (only used when on-chain verification confirms a different key).
     */
    public updateKnownPubkey(address: string, pubkeyHex: string, source: string = 'onchain_verified'): void {
        this.db.prepare(
            'INSERT OR REPLACE INTO known_pubkeys (address, pubkey_hex, source) VALUES (?, ?, ?)'
        ).run(address, pubkeyHex, source);
    }

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════

    public close(): void { this._db?.close(); this._db = null; }

    private get db(): Database.Database {
        if (!this._db) throw new Error('Database not initialized');
        return this._db;
    }

    // ═══════════════════════════════════════════════════════════════
    // TABLE CREATION
    // ═══════════════════════════════════════════════════════════════

    private createTables(): void {
        this.db.exec(`
            -- ── Original tables (unchanged) ──
            CREATE TABLE IF NOT EXISTS match_logs (
                match_id TEXT PRIMARY KEY, seed TEXT NOT NULL, mode INTEGER NOT NULL,
                format INTEGER NOT NULL, buy_in TEXT NOT NULL, players TEXT NOT NULL,
                candles TEXT NOT NULL, trades TEXT NOT NULL, standings TEXT NOT NULL,
                payouts TEXT NOT NULL, timestamp INTEGER NOT NULL, raw_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS player_stats (
                address TEXT PRIMARY KEY, matches_played INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
                total_earnings TEXT NOT NULL DEFAULT '0', best_rank INTEGER NOT NULL DEFAULT 999,
                total_volume TEXT NOT NULL DEFAULT '0',
                current_win_streak INTEGER NOT NULL DEFAULT 0,
                best_win_streak INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS player_profiles (
                address TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                twitter_handle TEXT, avatar_url TEXT,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS player_quests (
                address TEXT NOT NULL, quest_id TEXT NOT NULL,
                completed_at INTEGER NOT NULL DEFAULT (unixepoch()),
                points_earned INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (address, quest_id)
            );
            CREATE TABLE IF NOT EXISTS player_points (
                address TEXT PRIMARY KEY,
                total_points INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS referral_links (
                address TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
                total_referrals INTEGER NOT NULL DEFAULT 0,
                total_bonus_points INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS referral_claims (
                referrer_address TEXT NOT NULL,
                referred_address TEXT NOT NULL UNIQUE,
                has_played INTEGER NOT NULL DEFAULT 0,
                referral_volume TEXT NOT NULL DEFAULT '0',
                claimed_at INTEGER NOT NULL DEFAULT (unixepoch()),
                PRIMARY KEY (referred_address)
            );

            -- ── NEW: 4-Pillar Points ──
            CREATE TABLE IF NOT EXISTS player_points_v2 (
                address TEXT PRIMARY KEY,
                engagement_pts INTEGER NOT NULL DEFAULT 0,
                skill_pts INTEGER NOT NULL DEFAULT 0,
                volume_pts INTEGER NOT NULL DEFAULT 0,
                community_pts INTEGER NOT NULL DEFAULT 0
            );

            -- ── NEW: Point Events Log (audit trail) ──
            CREATE TABLE IF NOT EXISTS point_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address TEXT NOT NULL,
                source TEXT NOT NULL,
                engagement INTEGER NOT NULL DEFAULT 0,
                skill INTEGER NOT NULL DEFAULT 0,
                volume INTEGER NOT NULL DEFAULT 0,
                community INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            -- ── NEW: Daily Activity ──
            CREATE TABLE IF NOT EXISTS daily_activity (
                address TEXT NOT NULL,
                date TEXT NOT NULL,
                matches_played INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0,
                points_earned INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (address, date)
            );

            -- ── NEW: Login Streaks ──
            CREATE TABLE IF NOT EXISTS login_streaks (
                address TEXT PRIMARY KEY,
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak INTEGER NOT NULL DEFAULT 0,
                last_active_date TEXT NOT NULL
            );

            -- ── NEW: Win Streak Bonuses Awarded ──
            CREATE TABLE IF NOT EXISTS streak_bonuses_awarded (
                address TEXT NOT NULL,
                streak_threshold INTEGER NOT NULL,
                awarded_at INTEGER NOT NULL DEFAULT (unixepoch()),
                PRIMARY KEY (address, streak_threshold)
            );

            -- ── NEW: ELO Ratings ──
            CREATE TABLE IF NOT EXISTS elo_ratings (
                address TEXT PRIMARY KEY,
                elo INTEGER NOT NULL DEFAULT 1000,
                updated_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            -- ── NEW: Seasons ──
            CREATE TABLE IF NOT EXISTS seasons (
                season_id INTEGER PRIMARY KEY,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                ended INTEGER NOT NULL DEFAULT 0
            );

            -- ── NEW: Season Snapshots ──
            CREATE TABLE IF NOT EXISTS season_snapshots (
                season_id INTEGER NOT NULL,
                address TEXT NOT NULL,
                elo INTEGER NOT NULL,
                rank INTEGER NOT NULL,
                engagement_pts INTEGER NOT NULL DEFAULT 0,
                skill_pts INTEGER NOT NULL DEFAULT 0,
                volume_pts INTEGER NOT NULL DEFAULT 0,
                community_pts INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (season_id, address)
            );

            -- ── NEW: Referral Points Tracking (per-referral caps) ──
            CREATE TABLE IF NOT EXISTS referral_points_tracking (
                referrer_address TEXT NOT NULL,
                referred_address TEXT NOT NULL,
                points INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (referrer_address, referred_address)
            );

            -- ── NEW: Point Decay Log ──
            CREATE TABLE IF NOT EXISTS point_decay_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address TEXT NOT NULL,
                decay_amount INTEGER NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            -- ── NEW: Session Tokens (L-01: persist across restarts) ──
            CREATE TABLE IF NOT EXISTS session_tokens (
                token TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            -- ── Indexes ──
            -- ── NEW: Settled Matches (Bug 4.5) ──
            CREATE TABLE IF NOT EXISTS settled_matches (
                match_id TEXT PRIMARY KEY,
                tx_hash TEXT NOT NULL DEFAULT 'pending',
                settled_at INTEGER NOT NULL DEFAULT (unixepoch())
            );

            -- ── NEW: Per-Mode Player Stats (Sprint 2) ──
            CREATE TABLE IF NOT EXISTS player_mode_stats (
                address TEXT NOT NULL,
                mode INTEGER NOT NULL,

                -- Universal
                matches_played INTEGER NOT NULL DEFAULT 0,
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                total_volume TEXT NOT NULL DEFAULT '0',
                total_earnings TEXT NOT NULL DEFAULT '0',
                best_rank INTEGER NOT NULL DEFAULT 999,
                current_win_streak INTEGER NOT NULL DEFAULT 0,
                best_win_streak INTEGER NOT NULL DEFAULT 0,
                total_trades INTEGER NOT NULL DEFAULT 0,
                total_items_used INTEGER NOT NULL DEFAULT 0,
                total_items_received INTEGER NOT NULL DEFAULT 0,
                total_position_ticks INTEGER NOT NULL DEFAULT 0,

                -- Classic
                total_trades_of_limit INTEGER NOT NULL DEFAULT 0,
                perfect_reads INTEGER NOT NULL DEFAULT 0,
                one_trade_wins INTEGER NOT NULL DEFAULT 0,
                full_trade_wins INTEGER NOT NULL DEFAULT 0,
                clutch_triggers INTEGER NOT NULL DEFAULT 0,
                clutch_wins INTEGER NOT NULL DEFAULT 0,
                comebacks INTEGER NOT NULL DEFAULT 0,

                -- Survival
                total_bounties_claimed INTEGER NOT NULL DEFAULT 0,
                total_bounty_target_ticks INTEGER NOT NULL DEFAULT 0,
                total_ring_escapes INTEGER NOT NULL DEFAULT 0,
                total_items_looted INTEGER NOT NULL DEFAULT 0,
                best_survival_tick INTEGER NOT NULL DEFAULT 0,
                survived_past_200_count INTEGER NOT NULL DEFAULT 0,
                no_items_wins INTEGER NOT NULL DEFAULT 0,

                -- Chaos
                total_mutators_experienced INTEGER NOT NULL DEFAULT 0,
                unique_mutators_seen TEXT NOT NULL DEFAULT '[]',
                total_flips_survived INTEGER NOT NULL DEFAULT 0,
                profitable_flips INTEGER NOT NULL DEFAULT 0,
                total_gold_rush_pnl REAL NOT NULL DEFAULT 0,
                robin_hood_victim_count INTEGER NOT NULL DEFAULT 0,
                phantom_trades INTEGER NOT NULL DEFAULT 0,
                phantom_profits INTEGER NOT NULL DEFAULT 0,
                best_chaos_multiplier_win REAL NOT NULL DEFAULT 0,
                worst_chaos_multiplier_win REAL NOT NULL DEFAULT 10,
                items_used_single_match_best INTEGER NOT NULL DEFAULT 0,

                PRIMARY KEY (address, mode)
            );

            CREATE INDEX IF NOT EXISTS idx_match_logs_timestamp ON match_logs(timestamp);
            CREATE INDEX IF NOT EXISTS idx_match_logs_players ON match_logs(players);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON player_profiles(username COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_referral_claims_referrer ON referral_claims(referrer_address);
            CREATE INDEX IF NOT EXISTS idx_daily_activity_date ON daily_activity(date);
            CREATE INDEX IF NOT EXISTS idx_point_events_address ON point_events(address);
            CREATE INDEX IF NOT EXISTS idx_elo_ratings_elo ON elo_ratings(elo DESC);
            CREATE INDEX IF NOT EXISTS idx_login_streaks_date ON login_streaks(last_active_date);
            CREATE INDEX IF NOT EXISTS idx_point_decay_address ON point_decay_log(address);
            CREATE INDEX IF NOT EXISTS idx_mode_stats_address ON player_mode_stats(address);

            -- ── P0 FIX: Processed Deposits (double-deposit prevention) ──
            CREATE TABLE IF NOT EXISTS processed_deposits (
                tx_hash TEXT PRIMARY KEY,
                player_address TEXT NOT NULL,
                amount TEXT NOT NULL,
                credited_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_processed_deposits_player ON processed_deposits(player_address);

            -- ── SPRINT 2 FIX: Off-chain escrow ledger (instant balance tracking) ──
            CREATE TABLE IF NOT EXISTS escrow_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                address TEXT NOT NULL,
                amount TEXT NOT NULL,
                type TEXT NOT NULL,
                match_id TEXT,
                tx_hash TEXT,
                status TEXT NOT NULL DEFAULT 'confirmed',
                created_at INTEGER NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_escrow_ledger_address ON escrow_ledger(address);
        `);
    }

    /**
     * Run migrations for existing databases.
     * Safe to run multiple times (uses IF NOT EXISTS / OR IGNORE).
     */
    private runMigrations(): void {
        // Migration: seed player_points_v2 from legacy player_points
        const needsMigration = this.db.prepare(`
            SELECT COUNT(*) as cnt FROM player_points
            WHERE address NOT IN (SELECT address FROM player_points_v2)
        `).get() as { cnt: number };

        if (needsMigration.cnt > 0) {
            logger.info(TAG, `Migrating ${needsMigration.cnt} players to v2 points system...`);
            this.db.prepare(`
                INSERT OR IGNORE INTO player_points_v2 (address, engagement_pts, skill_pts, volume_pts, community_pts)
                SELECT address, total_points, 0, 0, 0 FROM player_points
                WHERE address NOT IN (SELECT address FROM player_points_v2)
            `).run();
            logger.info(TAG, 'Migration complete. Legacy points moved to engagement pillar.');
        }

        // Migration: P0 FIX — processed_deposits table (safe for existing DBs)
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS processed_deposits (
                    tx_hash TEXT PRIMARY KEY,
                    player_address TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    credited_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_processed_deposits_player ON processed_deposits(player_address);
            `);
        } catch { /* table already exists */ }

        // Migration: SPRINT 2 — escrow_ledger table
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS escrow_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    address TEXT NOT NULL,
                    amount TEXT NOT NULL,
                    type TEXT NOT NULL,
                    match_id TEXT,
                    tx_hash TEXT,
                    status TEXT NOT NULL DEFAULT 'confirmed',
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE INDEX IF NOT EXISTS idx_escrow_ledger_address ON escrow_ledger(address);
            `);
        } catch { /* table already exists */ }

        // Migration: C-03 FIX — add status column to escrow_ledger (safe for existing DBs)
        try {
            this.db.exec(`ALTER TABLE escrow_ledger ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'`);
            logger.info(TAG, 'Migration: added status column to escrow_ledger');
        } catch { /* column already exists — expected after first run */ }

        // Migration: SPRINT 3 — clean up ancient pending settlements (>1 hour old)
        try {
            const cleaned = this.db.prepare(
                "UPDATE settled_matches SET tx_hash = 'stale_cleared' WHERE tx_hash = 'pending' AND settled_at < unixepoch() - 3600"
            ).run();
            if (cleaned.changes > 0) {
                logger.info(TAG, `Cleared ${cleaned.changes} stale pending settlement(s) older than 1 hour`);
            }
        } catch { /* ignore */ }

        // Migration: H-01 FIX — known_pubkeys table (first-seen pubkey pinning)
        try {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS known_pubkeys (
                    address TEXT PRIMARY KEY,
                    pubkey_hex TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'first_auth',
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
            `);
        } catch { /* table already exists */ }
    }
}

// ═══════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

export interface PlayerStats {
    readonly address: string;
    readonly matches_played: number;
    readonly wins: number;
    readonly losses: number;
    readonly total_earnings: string;
    readonly best_rank: number;
    readonly total_volume: string;
    readonly current_win_streak: number;
    readonly best_win_streak: number;
}

export interface PlayerModeStats {
    readonly address: string;
    readonly mode: number;
    // Universal
    readonly matches_played: number;
    readonly wins: number;
    readonly losses: number;
    readonly total_volume: string;
    readonly total_earnings: string;
    readonly best_rank: number;
    readonly current_win_streak: number;
    readonly best_win_streak: number;
    readonly total_trades: number;
    readonly total_items_used: number;
    readonly total_items_received: number;
    readonly total_position_ticks: number;
    // Classic
    readonly total_trades_of_limit: number;
    readonly perfect_reads: number;
    readonly one_trade_wins: number;
    readonly full_trade_wins: number;
    readonly clutch_triggers: number;
    readonly clutch_wins: number;
    readonly comebacks: number;
    // Survival
    readonly total_bounties_claimed: number;
    readonly total_bounty_target_ticks: number;
    readonly total_ring_escapes: number;
    readonly total_items_looted: number;
    readonly best_survival_tick: number;
    readonly survived_past_200_count: number;
    readonly no_items_wins: number;
    // Chaos
    readonly total_mutators_experienced: number;
    readonly unique_mutators_seen: string;   // JSON array
    readonly total_flips_survived: number;
    readonly profitable_flips: number;
    readonly total_gold_rush_pnl: number;
    readonly robin_hood_victim_count: number;
    readonly phantom_trades: number;
    readonly phantom_profits: number;
    readonly best_chaos_multiplier_win: number;
    readonly worst_chaos_multiplier_win: number;
    readonly items_used_single_match_best: number;
}

export interface PlayerProfile {
    readonly address: string;
    readonly username: string;
    readonly twitter_handle: string | null;
    readonly avatar_url: string | null;
    readonly created_at: number;
}

export interface BattleLogEntry {
    readonly matchId: string;
    readonly mode: number;
    readonly format: number;
    readonly buyIn: string;
    readonly playerCount: number;
    readonly rank: number;
    readonly finalEquity: number;
    readonly timestamp: number;
}

export interface ReferralStats {
    readonly code: string;
    readonly referralUrl: string;
    readonly totalReferrals: number;
    readonly totalBonusPoints: number;
    readonly referredPlayers: Array<{ address: string; displayName: string }>;
    readonly hasReferrer: boolean;
}

export interface PillarPoints {
    engagement: number;
    skill: number;
    volume: number;
    community: number;
}

interface PillarPointsRow {
    address: string;
    engagement_pts: number;
    skill_pts: number;
    volume_pts: number;
    community_pts: number;
}

export interface DailyActivityRow {
    address: string;
    date: string;
    matches_played: number;
    wins: number;
    points_earned: number;
}

export interface LoginStreakRow {
    address: string;
    current_streak: number;
    best_streak: number;
    last_active_date: string;
}

interface EloRow {
    address: string;
    elo: number;
    updated_at: number;
}

interface SeasonRow {
    season_id: number;
    start_date: string;
    end_date: string;
    ended: number;
}

export const db = new AppDatabase();
