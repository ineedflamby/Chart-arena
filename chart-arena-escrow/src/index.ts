/**
 * ChartArenaEscrow — Entry Point
 *
 * Three required elements:
 *  1. Factory function (Blockchain.contract)
 *  2. Runtime exports
 *  3. Abort handler
 */

import { Blockchain } from '@btc-vision/btc-runtime/runtime';
import { ChartArenaEscrow } from './contracts/ChartArenaEscrow';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';

// 1. Factory function — MUST return a new instance, NOT assign directly
Blockchain.contract = (): ChartArenaEscrow => {
    return new ChartArenaEscrow();
};

// 2. Runtime exports — CRITICAL: path is /runtime/exports, NOT /runtime
export * from '@btc-vision/btc-runtime/runtime/exports';

// 3. Abort handler
export function abort(message: string, fileName: string, line: u32, column: u32): void {
    revertOnError(message, fileName, line, column);
}