import React from 'react';
import ReactDOM from 'react-dom/client';
import { WalletConnectProvider } from '@btc-vision/walletconnect';
import { App } from './App';
import './index.css';

/** FE-5 FIX: Error boundary prevents white-screen crashes */
class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[Chart Arena] Render crash:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 16,
                    background: '#0b0a14', color: '#c4b8e8',
                    fontFamily: "'Chakra Petch', system-ui, sans-serif",
                }}>
                    <div style={{ fontSize: '2.5rem' }}>⚠️</div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#F4B8CE' }}>
                        Something went wrong
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: '#8b7fb0', maxWidth: 400, textAlign: 'center' }}>
                        Chart Arena hit an unexpected error. Your funds are safe on-chain.
                    </p>
                    <pre style={{
                        fontSize: '0.7rem', color: '#6b5b95', maxWidth: 500,
                        overflow: 'auto', padding: 12, background: '#13111f',
                        border: '1px solid rgba(146,180,244,0.1)', borderRadius: 4,
                    }}>
                        {this.state.error?.message}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 28px', border: '1.5px solid rgba(146,180,244,0.3)',
                            background: 'rgba(146,180,244,0.08)', color: '#92B4F4',
                            cursor: 'pointer', fontFamily: "'Chakra Petch', sans-serif",
                            fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.05em',
                        }}
                    >
                        Reload App
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <WalletConnectProvider theme="dark">
                <App />
            </WalletConnectProvider>
        </ErrorBoundary>
    </React.StrictMode>,
);
