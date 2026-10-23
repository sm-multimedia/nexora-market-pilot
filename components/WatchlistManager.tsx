"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellPlus,
  Loader2,
  Pencil,
  Star,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import SearchCommand from "@/components/SearchCommand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addToWatchlist,
  removeFromWatchlist,
} from "@/lib/actions/watchlist.actions";
import {
  deleteUserAlert,
  getUserAlerts,
  saveUserAlert,
} from "@/lib/actions/alerts.actions";
import { getStockQuote } from "@/lib/actions/finnhub.actions";

type WatchlistManagerProps = {
  initialWatchlist: WatchlistEntry[];
  initialAlerts: StockAlert[];
  initialStocks: StockWithWatchlistStatus[];
};

type AlertEditorProps = {
  stock: Pick<Stock, "symbol" | "name">;
  alert?: StockAlert;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: StockAlertInput) => void;
};

const formatPrice = (value?: number) =>
  value == null || !Number.isFinite(value)
    ? "--"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value < 1 ? 4 : 2,
      }).format(value);

const formatMarketCap = (value?: string) => {
  const marketCap = Number(value);
  if (value == null || !Number.isFinite(marketCap)) return "--";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(marketCap * 1_000_000);
};

const frequencyLabel: Record<AlertFrequency, string> = {
  minute: "Once per minute",
  hour: "Once per hour",
  day: "Once per day",
};

function AlertEditor({
  stock,
  alert,
  saving,
  onOpenChange,
  onSave,
}: AlertEditorProps) {
  const [alertName, setAlertName] = useState(
    alert?.alertName ?? `${stock.symbol} alert`,
  );
  const [kind, setKind] = useState<AlertKind>(alert?.kind ?? "price");
  const [condition, setCondition] = useState<AlertCondition>(
    alert?.condition ?? "greater",
  );
  const [threshold, setThreshold] = useState(
    alert ? String(alert.threshold) : "",
  );
  const [frequency, setFrequency] = useState<AlertFrequency>(
    alert?.frequency ?? "day",
  );

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({
      symbol: stock.symbol,
      company: stock.name,
      alertName,
      kind,
      condition,
      threshold: Number(threshold),
      frequency,
    });
  };

  return (
    <DialogContent className="alert-dialog max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle className="alert-title">
          {alert ? "Edit Alert" : "Create Alert"}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <label className="block space-y-2">
          <span className="form-label">Alert name</span>
          <input
            autoFocus
            required
            maxLength={80}
            value={alertName}
            onChange={(event) => setAlertName(event.target.value)}
            placeholder={`${stock.symbol} price target`}
            className="form-input w-full"
          />
        </label>

        <label className="block space-y-2">
          <span className="form-label">Stock identifier</span>
          <input
            readOnly
            value={`${stock.name} (${stock.symbol})`}
            className="form-input w-full opacity-70"
          />
        </label>

        <label className="block space-y-2">
          <span className="form-label">Alert type</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as AlertKind)}
            className="select-trigger"
          >
            <option value="price">Price</option>
            <option value="volume">Volume</option>
          </select>
        </label>

        <label className="block space-y-2">
          <span className="form-label">Condition</span>
          <select
            value={condition}
            onChange={(event) =>
              setCondition(event.target.value as AlertCondition)
            }
            className="select-trigger"
          >
            <option value="greater">Greater than (&gt;)</option>
            <option value="less">Less than (&lt;)</option>
          </select>
        </label>

        <label className="block space-y-2">
          <span className="form-label">
            {kind === "price"
              ? "Threshold value (USD)"
              : "Volume vs. 10-day average (%)"}
          </span>
          <span className="relative block">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-yellow-400">
              {kind === "price" ? "$" : "%"}
            </span>
            <input
              required
              type="number"
              min="0.01"
              step={kind === "price" ? "0.01" : "1"}
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              placeholder={kind === "price" ? "eg: 140" : "eg: 150"}
              className="form-input w-full pl-9"
            />
          </span>
        </label>

        <label className="block space-y-2">
          <span className="form-label">Notification frequency</span>
          <select
            value={frequency}
            onChange={(event) =>
              setFrequency(event.target.value as AlertFrequency)
            }
            className="select-trigger"
          >
            <option value="minute">Once per minute</option>
            <option value="hour">Once per hour</option>
            <option value="day">Once per day</option>
          </select>
        </label>

        <Button type="submit" disabled={saving} className="yellow-btn w-full">
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {alert ? "Save Changes" : "Create Alert"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => onOpenChange(false)}
          className="w-full text-gray-400"
        >
          Cancel
        </Button>
      </form>
    </DialogContent>
  );
}

export default function WatchlistManager({
  initialWatchlist,
  initialAlerts,
  initialStocks,
}: WatchlistManagerProps) {
  const router = useRouter();
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [selectedStock, setSelectedStock] = useState<Pick<
    Stock,
    "symbol" | "name"
  > | null>(null);
  const [editingAlert, setEditingAlert] = useState<StockAlert | undefined>();
  const [alertOpen, setAlertOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openCreateAlert = (stock: Pick<Stock, "symbol" | "name">) => {
    setSelectedStock(stock);
    setEditingAlert(undefined);
    setAlertOpen(true);
  };

  const addStock = async (stock: StockWithWatchlistStatus) => {
    if (watchlist.some((item) => item.symbol === stock.symbol)) {
      toast.info(`${stock.symbol} is already in your watchlist`);
      return;
    }

    setSaving(true);
    try {
      await addToWatchlist(stock.symbol, stock.name);
      const quote = await getStockQuote(stock.symbol).catch(() => undefined);
      setWatchlist((items) => [
        {
          symbol: stock.symbol,
          company: stock.name,
          addedAt: new Date().toISOString(),
          currentPrice: quote?.currentPrice,
          changePercent: quote?.changePercent,
          marketCap: quote?.marketCap,
          peRatio: quote?.peRatio,
        },
        ...items,
      ]);
      toast.success(`${stock.symbol} added to your watchlist`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add this stock",
      );
    } finally {
      setSaving(false);
    }
  };

  const removeStock = async (symbol: string) => {
    setSaving(true);
    try {
      await removeFromWatchlist(symbol);
      setWatchlist((items) => items.filter((item) => item.symbol !== symbol));
      toast.success(`${symbol} removed from your watchlist`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove this stock",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAlert = async (input: StockAlertInput) => {
    setSaving(true);
    try {
      await saveUserAlert(input, editingAlert?.id);
      setAlerts(await getUserAlerts());
      setAlertOpen(false);
      toast.success(editingAlert ? "Alert updated" : "Alert created");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save this alert",
      );
    } finally {
      setSaving(false);
    }
  };

  const editAlert = (alert: StockAlert) => {
    setSelectedStock({ symbol: alert.symbol, name: alert.company });
    setEditingAlert(alert);
    setAlertOpen(true);
  };

  const removeAlert = async (id: string) => {
    try {
      await deleteUserAlert(id);
      setAlerts((items) => items.filter((item) => item.id !== id));
      toast.success("Alert deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete this alert",
      );
    }
  };

  const stockForGlobalAlert = watchlist[0]
    ? { symbol: watchlist[0].symbol, name: watchlist[0].company }
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-yellow-400">
            Portfolio workspace
          </p>
          <h1 className="mt-2 text-3xl font-bold text-gray-100">Watchlist</h1>
          <p className="mt-2 text-sm text-gray-500">
            Follow your stocks and get notified when a target moves.
          </p>
        </div>
        <SearchCommand
          label={saving ? "Saving..." : "Add Stock"}
          initialStocks={initialStocks}
          onStockSelected={addStock}
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.8fr)]">
        <section className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-gray-100">
              Your stocks{" "}
              <span className="ml-1 text-sm font-normal text-gray-500">
                {watchlist.length}
              </span>
            </h2>
          </div>
          {watchlist.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-gray-600 bg-gray-800/40 px-6 text-center">
              <TrendingUp className="mb-3 size-8 text-teal-400" />
              <h3 className="text-lg font-semibold text-gray-100">
                Your watchlist is empty
              </h3>
              <p className="mt-2 max-w-sm text-sm text-gray-500">
                Search for a company or ticker and add it to start tracking its
                price.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-700 bg-gray-800">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-gray-700 text-sm text-gray-300">
                  <tr>
                    <th className="w-12 px-4 py-4" aria-label="Remove stock" />
                    <th className="px-4 py-4 font-medium">Company</th>
                    <th className="px-4 py-4 font-medium">Symbol</th>
                    <th className="px-4 py-4 font-medium">Price</th>
                    <th className="px-4 py-4 font-medium">Change</th>
                    <th className="px-4 py-4 font-medium">Market Cap</th>
                    <th className="px-4 py-4 font-medium">P/E Ratio</th>
                    <th className="px-4 py-4 text-right font-medium">Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map((item) => (
                    <tr
                      key={item.symbol}
                      className="border-t border-gray-700 text-sm text-gray-100 hover:bg-gray-700/40"
                    >
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          title={`Remove ${item.symbol} from watchlist`}
                          aria-label={`Remove ${item.symbol} from watchlist`}
                          disabled={saving}
                          onClick={() => removeStock(item.symbol)}
                          className="rounded-full bg-gray-700 p-2 text-yellow-400 transition-colors hover:bg-gray-600 hover:text-red-400 disabled:opacity-50"
                        >
                          <Star className="size-4 fill-current" />
                        </button>
                      </td>
                      <td className="max-w-56 truncate px-4 py-4 font-medium">
                        {item.company}
                      </td>
                      <td className="px-4 py-4 font-mono text-gray-400">
                        {item.symbol}
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {formatPrice(item.currentPrice)}
                      </td>
                      <td
                        className={`px-4 py-4 tabular-nums ${(item.changePercent ?? 0) >= 0 ? "text-teal-400" : "text-rose-400"}`}
                      >
                        {item.changePercent == null
                          ? "--"
                          : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`}
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {formatMarketCap(item.marketCap)}
                      </td>
                      <td className="px-4 py-4 tabular-nums">
                        {item.peRatio ?? "--"}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            openCreateAlert({
                              symbol: item.symbol,
                              name: item.company,
                            })
                          }
                          className="text-yellow-400 hover:bg-yellow-400/10 hover:text-yellow-300"
                        >
                          <BellPlus className="size-4" /> Add Alert
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-gray-100">
                Alerts{" "}
                <span className="ml-1 text-sm font-normal text-gray-500">
                  {alerts.length}
                </span>
              </h2>
            </div>
            <Button
              type="button"
              disabled={!stockForGlobalAlert}
              onClick={() =>
                stockForGlobalAlert && openCreateAlert(stockForGlobalAlert)
              }
              className="yellow-btn h-10 px-4 text-sm"
              title={
                !stockForGlobalAlert
                  ? "Add a stock before creating an alert"
                  : undefined
              }
            >
              <BellPlus className="size-4" /> Create Alert
            </Button>
          </div>

          <div className="flex max-h-[780px] min-h-56 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800 p-3">
            {alerts.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center">
                <BellPlus className="mb-3 size-7 text-gray-500" />
                <p className="font-medium text-gray-300">No active alerts</p>
                <p className="mt-1 text-sm text-gray-500">
                  Create a price or volume alert from a stock in your watchlist.
                </p>
              </div>
            ) : (
              alerts.map((alert) => {
                const stock = watchlist.find(
                  (item) => item.symbol === alert.symbol,
                );
                const condition = alert.condition === "greater" ? ">" : "<";
                const threshold =
                  alert.kind === "price"
                    ? formatPrice(alert.threshold)
                    : `${alert.threshold}% of 10-day average volume`;

                return (
                  <article
                    key={alert.id}
                    className="rounded-lg border border-gray-600 bg-gray-700 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-100">
                          {alert.company}
                        </p>
                        <p className="mt-1 text-xs font-mono text-gray-400">
                          {alert.symbol} ·{" "}
                          {alert.kind === "price" ? "Price" : "Volume"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => editAlert(alert)}
                          aria-label={`Edit ${alert.alertName}`}
                          title="Edit alert"
                          className="rounded p-2 text-gray-300 hover:bg-gray-600 hover:text-yellow-400"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAlert(alert.id)}
                          aria-label={`Delete ${alert.alertName}`}
                          title="Delete alert"
                          className="rounded p-2 text-gray-300 hover:bg-gray-600 hover:text-rose-400"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-2 border-t border-gray-600 pt-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-gray-400">
                          {alert.alertName}
                        </p>
                        <p className="mt-1 font-semibold text-white">
                          {alert.kind === "price" ? "Price" : "Volume"}{" "}
                          {condition} {threshold}
                        </p>
                      </div>
                      <span className="shrink-0 rounded bg-yellow-400/15 px-2 py-1 text-xs text-yellow-300">
                        {frequencyLabel[alert.frequency]}
                      </span>
                    </div>
                    {alert.lastTriggeredAt ? (
                      <p className="mt-3 text-xs text-gray-500">
                        Last triggered{" "}
                        {new Date(alert.lastTriggeredAt).toLocaleString()}
                      </p>
                    ) : null}
                    {stock?.currentPrice != null && alert.kind === "price" ? (
                      <p className="mt-2 text-xs text-gray-500">
                        Current price {formatPrice(stock.currentPrice)}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>

      <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
        {selectedStock ? (
          <AlertEditor
            key={`${editingAlert?.id ?? "new"}-${selectedStock.symbol}`}
            stock={selectedStock}
            alert={editingAlert}
            saving={saving}
            onOpenChange={setAlertOpen}
            onSave={saveAlert}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
