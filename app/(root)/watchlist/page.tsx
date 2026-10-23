import WatchlistManager from "@/components/WatchlistManager";
import { getUserAlerts } from "@/lib/actions/alerts.actions";
import { getStockQuote, searchStocks } from "@/lib/actions/finnhub.actions";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";

export default async function WatchlistPage() {
  const [watchlist, alerts, initialStocks] = await Promise.all([
    getUserWatchlist(),
    getUserAlerts(),
    searchStocks(),
  ]);

  const watchlistWithQuotes = await Promise.all(
    watchlist.map(async (item) => {
      try {
        return { ...item, ...(await getStockQuote(item.symbol)) };
      } catch {
        return item;
      }
    }),
  );

  return (
    <WatchlistManager
      initialWatchlist={watchlistWithQuotes}
      initialAlerts={alerts}
      initialStocks={initialStocks}
    />
  );
}
