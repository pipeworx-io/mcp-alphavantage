interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Alpha Vantage MCP — Stock market data, fundamentals, and earnings
 *
 * BYO key: requires a free Alpha Vantage API key from https://www.alphavantage.co/support/#api-key
 * Passed via _apiKey parameter. Free tier: 25 requests/day.
 *
 * Tools:
 * - av_quote: get real-time stock quote
 * - av_daily: get daily time series (price history)
 * - av_overview: get company overview/fundamentals
 * - av_income_statement: get income statement (annual + quarterly)
 * - av_balance_sheet: get balance sheet (annual + quarterly)
 * - av_earnings: get earnings data + EPS
 */


const BASE = 'https://www.alphavantage.co/query';

// ── Helpers ───────────────────────────────────────────────────────────

function extractKey(args: Record<string, unknown>): string {
  const key = args._apiKey as string;
  delete args._apiKey;
  if (!key) throw new Error('Alpha Vantage API key required. Get one free at https://www.alphavantage.co/support/#api-key and pass via _apiKey.');
  return key;
}

async function avGet(apiKey: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpha Vantage API error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Alpha Vantage returns error messages in the response body
  if (data['Error Message']) {
    throw new Error(`Alpha Vantage error: ${data['Error Message']}`);
  }
  if (data['Note']) {
    throw new Error(`Alpha Vantage rate limit: ${data['Note']}`);
  }
  if (data['Information']) {
    throw new Error(`Alpha Vantage: ${data['Information']}`);
  }

  return data;
}

// ── Tool definitions ──────────────────────────────────────────────────

const tools: McpToolExport['tools'] = [
  {
    name: 'av_quote',
    description:
      'Get a real-time stock quote including price, change, change percent, volume, and latest trading day.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "SOFI", "AFRM", "SQ", "PYPL")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_daily',
    description:
      'Get daily time series (open, high, low, close, volume) for a stock. Returns up to 100 recent trading days by default, or 20+ years of full history.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
        },
        outputsize: {
          type: 'string',
          description: '"compact" for last 100 data points (default), "full" for 20+ years of data',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_overview',
    description:
      'Get company overview and fundamentals including description, sector, market cap, P/E ratio, EPS, dividend yield, 52-week range, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "GOOGL")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_income_statement',
    description:
      'Get income statement data for a company, including both annual and quarterly reports. Shows revenue, gross profit, operating income, net income, EBITDA, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_balance_sheet',
    description:
      'Get balance sheet data for a company, including both annual and quarterly reports. Shows total assets, liabilities, equity, cash, debt, and more.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "TSLA")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_earnings',
    description:
      'Get earnings data for a company, including annual and quarterly EPS (reported and estimated), surprise amount, and surprise percentage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: { type: 'string', description: 'Alpha Vantage API key' },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "NVDA")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
];

// ── callTool dispatcher ───────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = extractKey(args);

  switch (name) {
    case 'av_quote':
      return getQuote(key, args.symbol as string);
    case 'av_daily':
      return getDaily(key, args.symbol as string, (args.outputsize as string) ?? 'compact');
    case 'av_overview':
      return getOverview(key, args.symbol as string);
    case 'av_income_statement':
      return getIncomeStatement(key, args.symbol as string);
    case 'av_balance_sheet':
      return getBalanceSheet(key, args.symbol as string);
    case 'av_earnings':
      return getEarnings(key, args.symbol as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Tool implementations ─────────────────────────────────────────────

async function getQuote(apiKey: string, symbol: string) {
  const data = (await avGet(apiKey, {
    function: 'GLOBAL_QUOTE',
    symbol,
  })) as { 'Global Quote': Record<string, string> };

  const q = data['Global Quote'];
  if (!q || Object.keys(q).length === 0) {
    throw new Error(`No quote data found for symbol: ${symbol}`);
  }

  return {
    symbol: q['01. symbol'] ?? symbol,
    open: q['02. open'] ?? null,
    high: q['03. high'] ?? null,
    low: q['04. low'] ?? null,
    price: q['05. price'] ?? null,
    volume: q['06. volume'] ?? null,
    latest_trading_day: q['07. latest trading day'] ?? null,
    previous_close: q['08. previous close'] ?? null,
    change: q['09. change'] ?? null,
    change_percent: q['10. change percent'] ?? null,
  };
}

async function getDaily(apiKey: string, symbol: string, outputsize: string) {
  const data = (await avGet(apiKey, {
    function: 'TIME_SERIES_DAILY',
    symbol,
    outputsize,
  })) as {
    'Meta Data': Record<string, string>;
    'Time Series (Daily)': Record<string, Record<string, string>>;
  };

  const meta = data['Meta Data'] ?? {};
  const timeSeries = data['Time Series (Daily)'] ?? {};

  const dates = Object.keys(timeSeries).sort().reverse();

  return {
    symbol: meta['2. Symbol'] ?? symbol,
    last_refreshed: meta['3. Last Refreshed'] ?? null,
    outputsize,
    data_points: dates.length,
    time_series: dates.map((date) => {
      const day = timeSeries[date];
      return {
        date,
        open: day['1. open'] ?? null,
        high: day['2. high'] ?? null,
        low: day['3. low'] ?? null,
        close: day['4. close'] ?? null,
        volume: day['5. volume'] ?? null,
      };
    }),
  };
}

async function getOverview(apiKey: string, symbol: string) {
  const data = (await avGet(apiKey, {
    function: 'OVERVIEW',
    symbol,
  })) as Record<string, string>;

  if (!data.Symbol && !data.Name) {
    throw new Error(`No overview data found for symbol: ${symbol}`);
  }

  return {
    symbol: data.Symbol ?? symbol,
    name: data.Name ?? null,
    description: data.Description ?? null,
    exchange: data.Exchange ?? null,
    currency: data.Currency ?? null,
    country: data.Country ?? null,
    sector: data.Sector ?? null,
    industry: data.Industry ?? null,
    market_cap: data.MarketCapitalization ?? null,
    pe_ratio: data.PERatio ?? null,
    peg_ratio: data.PEGRatio ?? null,
    book_value: data.BookValue ?? null,
    dividend_per_share: data.DividendPerShare ?? null,
    dividend_yield: data.DividendYield ?? null,
    eps: data.EPS ?? null,
    revenue_per_share: data.RevenuePerShareTTM ?? null,
    profit_margin: data.ProfitMargin ?? null,
    operating_margin: data.OperatingMarginTTM ?? null,
    return_on_assets: data.ReturnOnAssetsTTM ?? null,
    return_on_equity: data.ReturnOnEquityTTM ?? null,
    revenue_ttm: data.RevenueTTM ?? null,
    gross_profit_ttm: data.GrossProfitTTM ?? null,
    ebitda: data.EBITDA ?? null,
    beta: data.Beta ?? null,
    week_52_high: data['52WeekHigh'] ?? null,
    week_52_low: data['52WeekLow'] ?? null,
    moving_average_50: data['50DayMovingAverage'] ?? null,
    moving_average_200: data['200DayMovingAverage'] ?? null,
    shares_outstanding: data.SharesOutstanding ?? null,
    fiscal_year_end: data.FiscalYearEnd ?? null,
    latest_quarter: data.LatestQuarter ?? null,
  };
}

async function getIncomeStatement(apiKey: string, symbol: string) {
  const data = (await avGet(apiKey, {
    function: 'INCOME_STATEMENT',
    symbol,
  })) as {
    symbol: string;
    annualReports: Record<string, string>[];
    quarterlyReports: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_reports: (data.annualReports ?? []).map(formatIncomeReport),
    quarterly_reports: (data.quarterlyReports ?? []).slice(0, 8).map(formatIncomeReport),
  };
}

function formatIncomeReport(r: Record<string, string>) {
  return {
    fiscal_date: r.fiscalDateEnding ?? null,
    reported_currency: r.reportedCurrency ?? null,
    total_revenue: r.totalRevenue ?? null,
    cost_of_revenue: r.costOfRevenue ?? null,
    gross_profit: r.grossProfit ?? null,
    operating_expenses: r.operatingExpenses ?? null,
    operating_income: r.operatingIncome ?? null,
    net_income: r.netIncome ?? null,
    ebitda: r.ebitda ?? null,
    interest_expense: r.interestExpense ?? null,
    income_tax_expense: r.incomeTaxExpense ?? null,
    research_and_development: r.researchAndDevelopment ?? null,
  };
}

async function getBalanceSheet(apiKey: string, symbol: string) {
  const data = (await avGet(apiKey, {
    function: 'BALANCE_SHEET',
    symbol,
  })) as {
    symbol: string;
    annualReports: Record<string, string>[];
    quarterlyReports: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_reports: (data.annualReports ?? []).map(formatBalanceReport),
    quarterly_reports: (data.quarterlyReports ?? []).slice(0, 8).map(formatBalanceReport),
  };
}

function formatBalanceReport(r: Record<string, string>) {
  return {
    fiscal_date: r.fiscalDateEnding ?? null,
    reported_currency: r.reportedCurrency ?? null,
    total_assets: r.totalAssets ?? null,
    total_current_assets: r.totalCurrentAssets ?? null,
    cash_and_equivalents: r.cashAndCashEquivalentsAtCarryingValue ?? null,
    total_liabilities: r.totalLiabilities ?? null,
    total_current_liabilities: r.totalCurrentLiabilities ?? null,
    long_term_debt: r.longTermDebt ?? null,
    total_shareholder_equity: r.totalShareholderEquity ?? null,
    retained_earnings: r.retainedEarnings ?? null,
    common_stock_shares_outstanding: r.commonStockSharesOutstanding ?? null,
  };
}

async function getEarnings(apiKey: string, symbol: string) {
  const data = (await avGet(apiKey, {
    function: 'EARNINGS',
    symbol,
  })) as {
    symbol: string;
    annualEarnings: Record<string, string>[];
    quarterlyEarnings: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_earnings: (data.annualEarnings ?? []).map((r) => ({
      fiscal_date: r.fiscalDateEnding ?? null,
      reported_eps: r.reportedEPS ?? null,
    })),
    quarterly_earnings: (data.quarterlyEarnings ?? []).slice(0, 12).map((r) => ({
      fiscal_date: r.fiscalDateEnding ?? null,
      reported_date: r.reportedDate ?? null,
      reported_eps: r.reportedEPS ?? null,
      estimated_eps: r.estimatedEPS ?? null,
      surprise: r.surprise ?? null,
      surprise_percentage: r.surprisePercentage ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 10 }, provider: 'alphavantage' } satisfies McpToolExport;
