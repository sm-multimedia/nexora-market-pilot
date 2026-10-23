"use server";

import { auth } from "@/lib/better-auth/auth";
import { connectToDatabase } from "@/database/mongoose";
import { Watchlist } from "@/database/models/watchlist.model";
import { headers } from "next/headers";

async function getCurrentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

export async function getUserWatchlist(): Promise<WatchlistEntry[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const mongoose = await connectToDatabase();
  if (!mongoose.connection.db) throw new Error("MongoDB connection not found");

  const items = await Watchlist.find({ userId }).sort({ addedAt: -1 }).lean();
  return items.map((item) => ({
    symbol: item.symbol,
    company: item.company,
    addedAt: item.addedAt.toISOString(),
  }));
}

export async function addToWatchlist(symbol: string, company: string) {
  const userId = await getCurrentUserId();
  if (!userId)
    throw new Error("You must be signed in to update your watchlist");

  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedCompany = company.trim().slice(0, 120);
  if (!/^[A-Z0-9.-]{1,15}$/.test(normalizedSymbol) || !normalizedCompany) {
    throw new Error("Choose a valid stock before adding it");
  }

  await connectToDatabase();
  await Watchlist.updateOne(
    { userId, symbol: normalizedSymbol },
    {
      $setOnInsert: {
        userId,
        symbol: normalizedSymbol,
        company: normalizedCompany,
      },
    },
    { upsert: true },
  );
  return { success: true };
}

export async function removeFromWatchlist(symbol: string) {
  const userId = await getCurrentUserId();
  if (!userId)
    throw new Error("You must be signed in to update your watchlist");

  await connectToDatabase();
  await Watchlist.deleteOne({ userId, symbol: symbol.trim().toUpperCase() });
  return { success: true };
}

export async function getWatchlistSymbolsByEmail(
  email: string,
): Promise<string[]> {
  if (!email) return [];

  try {
    const mongoose = await connectToDatabase();
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection not found");

    // Better Auth stores users in the "user" collection
    const user = await db
      .collection("user")
      .findOne<{ _id?: unknown; id?: string; email?: string }>({ email });

    if (!user) return [];

    const userId = (user.id as string) || String(user._id || "");
    if (!userId) return [];

    const items = await Watchlist.find({ userId }, { symbol: 1 }).lean();
    return items.map((i) => String(i.symbol));
  } catch (err) {
    console.error("getWatchlistSymbolsByEmail error:", err);
    return [];
  }
}
