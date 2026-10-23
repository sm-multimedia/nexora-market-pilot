"use server";

import { UserAlert } from "@/database/models/alert.model";
import { connectToDatabase } from "@/database/mongoose";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";

async function getCurrentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id ?? null;
}

function validateAlert(input: StockAlertInput) {
  const symbol = input.symbol.trim().toUpperCase();
  const company = input.company.trim().slice(0, 120);
  const alertName = input.alertName.trim().slice(0, 80);
  const threshold = Number(input.threshold);

  if (!/^[A-Z0-9.-]{1,15}$/.test(symbol) || !company || !alertName) {
    throw new Error("Enter a valid stock and alert name");
  }
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("Threshold must be greater than zero");
  }
  if (!["price", "volume"].includes(input.kind)) {
    throw new Error("Choose a valid alert type");
  }
  if (!["greater", "less"].includes(input.condition)) {
    throw new Error("Choose a valid alert condition");
  }
  if (!["minute", "hour", "day"].includes(input.frequency)) {
    throw new Error("Choose a valid notification frequency");
  }

  return { ...input, symbol, company, alertName, threshold };
}

export async function getUserAlerts(): Promise<StockAlert[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  await connectToDatabase();
  const alerts = await UserAlert.find({ userId, isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  return alerts.map((alert) => ({
    id: String(alert._id),
    symbol: alert.symbol,
    company: alert.company,
    alertName: alert.alertName,
    kind: alert.kind,
    condition: alert.condition,
    threshold: alert.threshold,
    frequency: alert.frequency,
    isActive: alert.isActive,
    lastTriggeredAt: alert.lastTriggeredAt?.toISOString() ?? null,
  }));
}

export async function saveUserAlert(input: StockAlertInput, alertId?: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("You must be signed in to manage alerts");

  const alert = validateAlert(input);
  await connectToDatabase();

  if (alertId) {
    const updated = await UserAlert.findOneAndUpdate(
      { _id: alertId, userId },
      {
        $set: {
          ...alert,
          lastTriggeredAt: null,
          lastTriggeredValue: undefined,
        },
      },
      { new: true, runValidators: true },
    );
    if (!updated) throw new Error("Alert not found");
    return { success: true };
  }

  await UserAlert.create({ ...alert, userId, isActive: true });
  return { success: true };
}

export async function deleteUserAlert(alertId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("You must be signed in to manage alerts");

  await connectToDatabase();
  const result = await UserAlert.deleteOne({ _id: alertId, userId });
  if (result.deletedCount === 0) throw new Error("Alert not found");
  return { success: true };
}
