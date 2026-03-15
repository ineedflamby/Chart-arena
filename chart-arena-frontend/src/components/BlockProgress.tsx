import { useState, useEffect } from 'react';

interface BlockProgressProps {
    label?: string;
    startBlock?: number;
    currentBlock?: number;
    elapsed?: number;
    avgBlockTime?: number;
    autoTimer?: boolean;
}

export function BlockProgress({
    label = 'Waiting for block confirmation...',
    startBlock,
    currentBlock,
    elapsed: externalElapsed,
    avgBlockTime = 600,
    autoTimer = true,
}: BlockProgressProps) {
    const [localElapsed, setLocalElapsed] = useState(0);

    useEffect(() => {
        if (!autoTimer) return;
        const start = Date.now();
        const iv = setInterval(() => {
            setLocalElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);
        return () => clearInterval(iv);
    }, [autoTimer]);

    const elapsed = externalElapsed ?? localElapsed;
    const progress = Math.min((elapsed / avgBlockTime) * 100, 99);
    const remaining = Math.max(avgBlockTime - elapsed, 0);
    const remainMin = Math.floor(remaining / 60);
    const remainSec = remaining % 60;
    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;

    return (
        <div style={{
            width: '100%', maxWidth: 360, margin: '12px auto 0',
            padding: '12px 14px',
            background: 'rgba(146,180,244,0.04)',
            border: '1px solid rgba(146,180,244,0.1)',
            clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
        }}>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 8,
            }}>
                <span style={{
                    fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700,
                    fontSize: '0.65rem', letterSpacing: '0.08em',
                    color: '#92B4F4', textTransform: 'uppercase',
                }}>
                    {label}
                </span>
                {currentBlock != null && (
                    <span style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '0.65rem', color: '#d4b978',
                    }}>
                        #{currentBlock}
                    </span>
                )}
            </div>

            {startBlock != null && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 6,
                }}>
                    <span style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '0.7rem', color: 'rgba(190,221,241,0.6)',
                    }}>
                        Block {startBlock}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'rgba(146,180,244,0.4)' }}>→</span>
                    <span style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '0.7rem', color: currentBlock && currentBlock > startBlock ? '#82C4A0' : '#d4b978',
                    }}>
                        Block {startBlock + 1} {currentBlock && currentBlock > startBlock ? '✓' : ''}
                    </span>
                </div>
            )}

            <div style={{
                width: '100%', height: 6,
                background: 'rgba(146,180,244,0.08)',
                clipPath: 'polygon(2px 0, 100% 0, calc(100% - 2px) 100%, 0 100%)',
                overflow: 'hidden', position: 'relative',
            }}>
                <div style={{
                    width: `${progress}%`, height: '100%',
                    background: progress > 80
                        ? 'linear-gradient(90deg, #92B4F4, #82C4A0)'
                        : 'linear-gradient(90deg, #92B4F4, #d4b978)',
                    transition: 'width 1s linear',
                    position: 'relative',
                }}>
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'repeating-linear-gradient(90deg, transparent, transparent 4px, rgba(255,255,255,0.1) 4px, rgba(255,255,255,0.1) 8px)',
                        animation: 'scanDrift 3s linear infinite',
                    }} />
                </div>
            </div>

            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: 6,
            }}>
                <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '0.6rem', color: 'rgba(190,221,241,0.5)',
                }}>
                    {elapsedMin}:{String(elapsedSec).padStart(2, '0')} elapsed
                </span>
                <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '0.6rem',
                    color: remaining < 120 ? '#82C4A0' : '#d4b978',
                }}>
                    ~{remainMin}:{String(remainSec).padStart(2, '0')} remaining
                </span>
            </div>
        </div>
    );
}
