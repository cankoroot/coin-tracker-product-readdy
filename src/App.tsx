import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import './App.css'

const API_BASE_URL = 'https://api.coingecko.com/api/v3'
const API_COOLDOWN_MS = 15_000

type Currency = 'usd' | 'try'
type RangeKey = '1d' | '7d' | '30d' | '365d'

type TrendingResponse = {
    coins: Array<{
        item: {
            id: string
            name: string
            symbol: string
            market_cap_rank: number
            thumb: string
            score: number
        }
    }>
}

type MarketCoin = {
    id: string
    symbol: string
    name: string
    image: string
    current_price: number
    price_change_percentage_24h: number
    market_cap: number
    total_volume: number
    sparkline_in_7d: {
        price: number[]
    }
}

type SearchResult = {
    id: string
    name: string
    symbol: string
    market_cap_rank: number | null
    thumb: string
}

type SearchResponse = {
    coins: SearchResult[]
}

type MarketChartResponse = {
    prices: Array<[number, number]>
}

type ChartPoint = {
    timestamp: number
    price: number
}

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number }> = [
    { key: '1d', label: '1 Gün', days: 1 },
    { key: '7d', label: '1 Hafta', days: 7 },
    { key: '30d', label: '1 Ay', days: 30 },
    { key: '365d', label: '1 Yıl', days: 365 },
]

const CURRENCY_OPTIONS: Array<{ key: Currency; label: string; symbol: string }> = [
    { key: 'usd', label: 'USD', symbol: '$' },
    { key: 'try', label: 'TRY', symbol: '₺' },
]

function formatCurrency(value: number, currency: Currency) {
    return new Intl.NumberFormat(currency === 'try' ? 'tr-TR' : 'en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
        maximumFractionDigits: value >= 1 ? 2 : 6,
    }).format(value)
}

function formatCompact(value: number, currency: Currency) {
    const label = new Intl.NumberFormat(currency === 'try' ? 'tr-TR' : 'en-US', {
        notation: 'compact',
        maximumFractionDigits: 2,
    }).format(value)

    return currency === 'try' ? `${label} ₺` : `${label} $`
}

function formatPercent(value: number) {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function formatChartLabel(timestamp: number, range: RangeKey) {
    const date = new Date(timestamp)

    if (range === '1d') {
        return new Intl.DateTimeFormat('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
        }).format(date)
    }

    if (range === '365d') {
        return new Intl.DateTimeFormat('tr-TR', {
            day: 'numeric',
            month: 'short',
        }).format(date)
    }

    return new Intl.DateTimeFormat('tr-TR', {
        day: 'numeric',
        month: 'short',
    }).format(date)
}

async function cgFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
    const directUrl = `${API_BASE_URL}${path}`
    const resp = await fetch(directUrl, {
        signal,
    })

    if (!resp.ok) {
        const errorText = await resp.text()
        throw new Error(errorText || `Request failed with ${resp.status}`)
    }

    return resp.json() as Promise<T>
}

function App() {
    const [currency, setCurrency] = useState<Currency>('usd')
    const [rangeKey, setRangeKey] = useState<RangeKey>('30d')
    const [trending, setTrending] = useState<TrendingResponse['coins']>([])
    const [markets, setMarkets] = useState<MarketCoin[]>([])
    const [selectedCoin, setSelectedCoin] = useState<SearchResult | null>(null)
    const [chartData, setChartData] = useState<ChartPoint[]>([])
    const [searchQuery, setSearchQuery] = useState('solana')
    const [searchResults, setSearchResults] = useState<SearchResult[]>([])
    const [loading, setLoading] = useState(true)
    const [searching, setSearching] = useState(false)
    const [error, setError] = useState('')
    const selectedCoinRef = useRef<SearchResult | null>(null)
    const lastManualRequestAtRef = useRef(0)

    useEffect(() => {
        selectedCoinRef.current = selectedCoin
    }, [selectedCoin])

    const rangeDays = useMemo(
        () => RANGE_OPTIONS.find((option) => option.key === rangeKey)?.days ?? 30,
        [rangeKey],
    )

    useEffect(() => {
        const controller = new AbortController()
        const currentSelectedCoin = selectedCoinRef.current

        const loadDashboard = async () => {
            try {
                const [trendingResponse, marketsResponse] = await Promise.all([
                    cgFetch<TrendingResponse>('/search/trending', controller.signal),
                    cgFetch<MarketCoin[]>(
                        `/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=8&page=1&sparkline=true`,
                        controller.signal,
                    ),
                ])

                if (controller.signal.aborted) return

                setTrending(trendingResponse.coins)
                setMarkets(marketsResponse)

                if (!currentSelectedCoin) {
                    const firstCoin = trendingResponse.coins[0]?.item
                    if (firstCoin) {
                        setSelectedCoin({
                            id: firstCoin.id,
                            name: firstCoin.name,
                            symbol: firstCoin.symbol,
                            market_cap_rank: firstCoin.market_cap_rank,
                            thumb: firstCoin.thumb,
                        })
                    }
                }
            } catch (requestError) {
                if (!controller.signal.aborted) {
                    setError(
                        requestError instanceof Error
                            ? requestError.message
                            : 'CoinGecko verileri yüklenemedi.',
                    )
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }

        void loadDashboard()

        return () => controller.abort()
    }, [currency])

    useEffect(() => {
        if (!selectedCoin) return

        const controller = new AbortController()

        const loadChart = async () => {
            try {
                const chartResponse = await cgFetch<MarketChartResponse>(
                    `/coins/${selectedCoin.id}/market_chart?vs_currency=${currency}&days=${rangeDays}`,
                    controller.signal,
                )

                if (!controller.signal.aborted) {
                    setChartData(
                        chartResponse.prices.map(([timestamp, price]) => ({
                            timestamp,
                            price,
                        })),
                    )
                }
            } catch (requestError) {
                if (!controller.signal.aborted) {
                    setError(
                        requestError instanceof Error
                            ? requestError.message
                            : 'Geçmiş chart yüklenemedi.',
                    )
                }
            }
        }

        void loadChart()

        return () => controller.abort()
    }, [currency, selectedCoin, rangeDays])

    const loadCoin = (coin: SearchResult) => {
        setSelectedCoin(coin)
        setError('')
    }

    const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const query = searchQuery.trim()
        if (!query) return

        const now = Date.now()
        const elapsedSinceLastRequest = now - lastManualRequestAtRef.current
        if (elapsedSinceLastRequest < API_COOLDOWN_MS) {
            setError('15 Saniye Bekleyin. API Cooldown devrede')
            return
        }

        lastManualRequestAtRef.current = now

        setSearching(true)
        setError('')

        try {
            const response = await cgFetch<SearchResponse>(
                `/search?query=${encodeURIComponent(query)}`,
            )

            const results = response.coins.slice(0, 6)
            setSearchResults(results)

            if (results[0]) {
                loadCoin(results[0])
            }
        } catch (requestError) {
            setError(
                requestError instanceof Error ? requestError.message : 'Arama başarısız oldu.',
            )
        } finally {
            setSearching(false)
        }
    }

    const latestPrice = chartData.at(-1)?.price ?? 0
    const firstPrice = chartData[0]?.price ?? 0
    const chartDelta = firstPrice ? ((latestPrice - firstPrice) / firstPrice) * 100 : 0
    const chartMin = chartData.length ? Math.min(...chartData.map((point) => point.price)) : 0
    const chartMax = chartData.length ? Math.max(...chartData.map((point) => point.price)) : 0
    const currencySymbol = CURRENCY_OPTIONS.find((option) => option.key === currency)?.symbol ?? '$'
    document.title = selectedCoin ? `${selectedCoin.name} fiyatı` : 'Cankoroot Piyasa Masası'

    return (
        <main className="dashboard-shell">

            <section className="hero-panel">
                <div className="hero-copy">
                    <p className="eyebrow">cankoroot piyasa masası</p>
                    <h1>Canlı kripto fiyatları, trend coinler ve seçilebilir geçmiş grafikler.</h1>
                    <p className="lede">
                        CoinGecko Demo API bağlı. Türkçe arayüz, USD/TRY para birimi seçimi, trend listesi,
                        piyasa kartları ve Recharts ile çizilmiş geçmiş fiyat grafiği tek ekranda.
                    </p>

                    <div className="control-row">
                        <div className="control-group">
                            <span>Para birimi</span>
                            <div className="segment-group" role="group" aria-label="Para birimi seçimi">
                                {CURRENCY_OPTIONS.map((option) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        className={option.key === currency ? 'segment-button active' : 'segment-button'}
                                        onClick={() => setCurrency(option.key)}
                                    >
                                        {option.symbol} {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <form className="search-form" onSubmit={handleSearch}>
                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Coin adı ya da sembolü ile ara"
                                aria-label="CoinGecko araması"
                            />
                            <button type="submit" disabled={searching}>
                                {searching ? 'Aranıyor…' : 'Coin bul'}
                            </button>
                        </form>
                    </div>

                    <div className="hero-stats">
                        <article>
                            <span>Trend coin</span>
                            <strong>{trending.length || '—'}</strong>
                        </article>
                        <article>
                            <span>Piyasa kartı</span>
                            <strong>{markets.length || '—'}</strong>
                        </article>
                        <article>
                            <span>Grafik hareketi</span>
                            <strong className={chartDelta >= 0 ? 'positive' : 'negative'}>
                                {chartData.length ? formatPercent(chartDelta) : '—'}
                            </strong>
                        </article>
                    </div>
                </div>

                <aside className="selected-coin-card">
                    <div className="selected-coin-head">
                        {selectedCoin?.thumb ? <img src={selectedCoin.thumb} alt="" /> : null}
                        <div>
                            <p>Seçili coin</p>
                            <h2>
                                {selectedCoin
                                    ? `${selectedCoin.name} (${selectedCoin.symbol.toUpperCase()})`
                                    : 'Yükleniyor…'}
                            </h2>
                        </div>
                    </div>

                    <div className="selected-price">
                        <strong>{latestPrice ? formatCurrency(latestPrice, currency) : '—'}</strong>
                        <span className={chartDelta >= 0 ? 'positive' : 'negative'}>
                            {chartData.length ? formatPercent(chartDelta) : '—'}
                        </span>
                    </div>

                    <div className="selected-range">
                        <span>{rangeDays} günlük düşük</span>
                        <strong>{chartMin ? formatCurrency(chartMin, currency) : '—'}</strong>
                        <span>{rangeDays} günlük yüksek</span>
                        <strong>{chartMax ? formatCurrency(chartMax, currency) : '—'}</strong>
                    </div>
                </aside>
            </section>

            <section className="chart-panel">
                <div className="panel-header">
                    <div>
                        <p className="eyebrow">Geçmiş grafik</p>
                        <h2>{selectedCoin?.name ?? 'Seçili coin'} fiyat hareketi</h2>
                    </div>

                    <div className="range-switch" role="group" aria-label="Geçmiş zaman aralığı">
                        {RANGE_OPTIONS.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                className={option.key === rangeKey ? 'segment-button active' : 'segment-button'}
                                onClick={() => setRangeKey(option.key)}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="chart-summary">
                    <article>
                        <span>Son fiyat</span>
                        <strong>
                            {latestPrice ? formatCurrency(latestPrice, currency) : '—'}
                            <small>{currencySymbol}</small>
                        </strong>
                    </article>
                    <article>
                        <span>Son değişim</span>
                        <strong className={chartDelta >= 0 ? 'positive' : 'negative'}>
                            {chartData.length ? formatPercent(chartDelta) : '—'}
                        </strong>
                    </article>
                    <article>
                        <span>Aralık</span>
                        <strong>{RANGE_OPTIONS.find((option) => option.key === rangeKey)?.label}</strong>
                    </article>
                </div>

                <div className="chart-wrap">
                    {chartData.length ? (
                        <ResponsiveContainer width="100%" height={320}>
                            <AreaChart data={chartData} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="chart-gradient" x1="0" x2="0" y1="0" y2="1">
                                        <stop offset="0%" stopColor="#74d0ff" stopOpacity={0.45} />
                                        <stop offset="100%" stopColor="#74d0ff" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="rgba(160, 184, 255, 0.12)" strokeDasharray="4 6" />
                                <XAxis
                                    dataKey="timestamp"
                                    tickFormatter={(value) => formatChartLabel(value, rangeKey)}
                                    tick={{ fill: 'rgba(186, 197, 225, 0.85)', fontSize: 12 }}
                                    axisLine={false}
                                    tickLine={false}
                                    minTickGap={24}
                                />
                                <YAxis
                                    width={72}
                                    tickFormatter={(value) => formatCompact(Number(value), currency)}
                                    tick={{ fill: 'rgba(186, 197, 225, 0.85)', fontSize: 12 }}
                                    axisLine={false}
                                    tickLine={false}
                                    domain={["auto", "auto"]}
                                />
                                <Tooltip
                                    formatter={(value) => [formatCurrency(Number(value), currency), 'Fiyat']}
                                    labelFormatter={(value) => formatChartLabel(Number(value), rangeKey)}
                                    contentStyle={{
                                        background: 'rgba(5, 8, 22, 0.95)',
                                        border: '1px solid rgba(160, 184, 255, 0.16)',
                                        borderRadius: '16px',
                                        color: '#f7faff',
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="price"
                                    stroke="#74d0ff"
                                    strokeWidth={3}
                                    fill="url(#chart-gradient)"
                                    dot={false}
                                    activeDot={{ r: 4 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">Grafik verisi yükleniyor…</div>
                    )}
                </div>
            </section>

            <section className="grid-grid">
                <div className="panel-section">
                    <div className="panel-header">
                        <div>
                            <p className="eyebrow">Piyasa kartları</p>
                            <h2>İlk 4 varlık</h2>
                        </div>
                    </div>

                    <div className="price-grid">
                        {markets.slice(0, 4).map((coin) => (
                            <button
                                key={coin.id}
                                type="button"
                                className="price-card"
                                onClick={() =>
                                    loadCoin({
                                        id: coin.id,
                                        name: coin.name,
                                        symbol: coin.symbol,
                                        market_cap_rank: null,
                                        thumb: coin.image,
                                    })
                                }
                            >
                                <div className="card-top">
                                    <img src={coin.image} alt="" />
                                    <div>
                                        <strong>{coin.name}</strong>
                                        <span>{coin.symbol.toUpperCase()}</span>
                                    </div>
                                </div>
                                <div className="card-price">{formatCurrency(coin.current_price, currency)}</div>
                                <div className={coin.price_change_percentage_24h >= 0 ? 'positive' : 'negative'}>
                                    {formatPercent(coin.price_change_percentage_24h)}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="panel-section">
                    <div className="panel-header">
                        <div>
                            <p className="eyebrow">Piyasa tablosu</p>
                            <h2>Market cap’e göre ilk 8</h2>
                        </div>
                    </div>

                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Varlık</th>
                                    <th>Fiyat</th>
                                    <th>24 sa.</th>
                                    <th>Piyasa değeri</th>
                                    <th>Hacim</th>
                                </tr>
                            </thead>
                            <tbody>
                                {markets.map((coin) => (
                                    <tr
                                        key={coin.id}
                                        onClick={() =>
                                            loadCoin({
                                                id: coin.id,
                                                name: coin.name,
                                                symbol: coin.symbol,
                                                market_cap_rank: null,
                                                thumb: coin.image,
                                            })
                                        }
                                    >
                                        <td>
                                            <div className="table-asset">
                                                <img src={coin.image} alt="" />
                                                <div>
                                                    <strong>{coin.name}</strong>
                                                    <span>{coin.symbol.toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>{formatCurrency(coin.current_price, currency)}</td>
                                        <td className={coin.price_change_percentage_24h >= 0 ? 'positive' : 'negative'}>
                                            {formatPercent(coin.price_change_percentage_24h)}
                                        </td>
                                        <td>{formatCompact(coin.market_cap, currency)}</td>
                                        <td>{formatCompact(coin.total_volume, currency)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            <section className="panel-section trending-panel">
                <div className="panel-header">
                    <div>
                        <p className="eyebrow">Trendler</p>
                        <h2>CoinGecko’da öne çıkan 7 coin</h2>
                    </div>
                    <p className="panel-note">Bir öğeye tıklayın, grafik o coine geçsin.</p>
                </div>

                <div className="trending-list">
                    {trending.map(({ item }) => (
                        <button
                            key={item.id}
                            type="button"
                            className="trending-item"
                            onClick={() =>
                                loadCoin({
                                    id: item.id,
                                    name: item.name,
                                    symbol: item.symbol,
                                    market_cap_rank: item.market_cap_rank,
                                    thumb: item.thumb,
                                })
                            }
                        >
                            <img src={item.thumb} alt="" />
                            <div>
                                <strong>{item.name}</strong>
                                <span>
                                    {item.symbol.toUpperCase()} · sıra {item.market_cap_rank}
                                </span>
                            </div>
                            <span className="trend-score">#{item.score + 1}</span>
                        </button>
                    ))}
                </div>

                {searchResults.length > 0 ? (
                    <div className="search-results">
                        <p className="eyebrow">Arama sonuçları</p>
                        <div className="result-list">
                            {searchResults.map((coin) => (
                                <button key={coin.id} type="button" onClick={() => loadCoin(coin)}>
                                    <img src={coin.thumb} alt="" />
                                    <span>
                                        {coin.name} ({coin.symbol.toUpperCase()})
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
            </section>

            {loading ? <div className="status-banner">CoinGecko verileri yükleniyor…</div> : null}
            {error ? <div className="status-banner error">{error}</div> : null}

            <footer>
                <div className="footer-links">
                    <p>&copy; 2026 <a href="https://github.com/cankoroot" target="_blank" rel="noopener noreferrer">cankoroot</a>. CoinGecko API, Typescript, Recharts.js kullanılarak yapılmıştır. Tüm hakları saklıdır.</p>
                </div>
            </footer>
        </main>

    )
}

export default App
