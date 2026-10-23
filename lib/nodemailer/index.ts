import nodemailer from "nodemailer";
import {
  WELCOME_EMAIL_TEMPLATE,
  NEWS_SUMMARY_EMAIL_TEMPLATE,
  STOCK_ALERT_UPPER_EMAIL_TEMPLATE,
  STOCK_ALERT_LOWER_EMAIL_TEMPLATE,
  VOLUME_ALERT_EMAIL_TEMPLATE,
} from "@/lib/nodemailer/templates";

function renderEmailTemplate(template: string, values: Record<string, string>) {
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => values[key] ?? (key === "baseUrl" ? baseUrl : ""),
  );
}

function formatAlertPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.NODEMAILER_EMAIL!,
    pass: process.env.NODEMAILER_PASSWORD!,
  },
});

export const sendWelcomeEmail = async ({
  email,
  name,
  intro,
}: WelcomeEmailData) => {
  const htmlTemplate = renderEmailTemplate(WELCOME_EMAIL_TEMPLATE, {
    name,
    intro,
  });

  const mailOptions = {
    from: { name: "MarketPilot", address: process.env.NODEMAILER_EMAIL! },
    to: email,
    subject: `Welcome to MarketPilot - your stock market toolkit is ready!`,
    text: "Thanks for joining MarketPilot",
    html: htmlTemplate,
  };

  await transporter.sendMail(mailOptions);
};

export const sendNewsSummaryEmail = async ({
  email,
  date,
  newsContent,
}: {
  email: string;
  date: string;
  newsContent: string;
}): Promise<void> => {
  const htmlTemplate = renderEmailTemplate(NEWS_SUMMARY_EMAIL_TEMPLATE, {
    date,
    newsContent,
  });

  const mailOptions = {
    from: { name: "MarketPilot News", address: process.env.NODEMAILER_EMAIL! },
    to: email,
    subject: `📈 Market News Summary Today - ${date}`,
    text: `Today's market news summary from MarketPilot`,
    html: htmlTemplate,
  };

  await transporter.sendMail(mailOptions);
};

export async function sendPriceAlertEmail({
  email,
  symbol,
  company,
  condition,
  threshold,
  currentPrice,
}: {
  email: string;
  symbol: string;
  company: string;
  condition: AlertCondition;
  threshold: number;
  currentPrice: number;
}) {
  const isUpper = condition === "greater";
  const template = isUpper
    ? STOCK_ALERT_UPPER_EMAIL_TEMPLATE
    : STOCK_ALERT_LOWER_EMAIL_TEMPLATE;
  const targetPrice = formatAlertPrice(threshold);
  const html = renderEmailTemplate(template, {
    timestamp: new Date().toLocaleString("en-US", {
      timeZone: "UTC",
      timeZoneName: "short",
    }),
    symbol,
    company,
    currentPrice: formatAlertPrice(currentPrice),
    targetPrice,
  });

  await transporter.sendMail({
    from: {
      name: "MarketPilot Alerts",
      address: process.env.NODEMAILER_EMAIL!,
    },
    to: email,
    subject: `${symbol} price alert: ${isUpper ? "above" : "below"} ${targetPrice}`,
    text: `${symbol} is ${formatAlertPrice(currentPrice)} and crossed your ${targetPrice} price alert.`,
    html,
  });
}

export async function sendVolumeAlertEmail({
  email,
  symbol,
  company,
  condition,
  threshold,
  currentVolume,
  averageVolume,
  currentPrice,
  changePercent,
}: {
  email: string;
  symbol: string;
  company: string;
  condition: AlertCondition;
  threshold: number;
  currentVolume: number;
  averageVolume: number;
  currentPrice: number;
  changePercent: number;
}) {
  const volumePercent = (currentVolume / averageVolume) * 100;
  const html = renderEmailTemplate(VOLUME_ALERT_EMAIL_TEMPLATE, {
    timestamp: new Date().toLocaleString("en-US", {
      timeZone: "UTC",
      timeZoneName: "short",
    }),
    symbol,
    company,
    currentVolume: (currentVolume / 1_000_000).toFixed(2),
    averageVolume: (averageVolume / 1_000_000).toFixed(2),
    currentPrice: formatAlertPrice(currentPrice),
    priceColor: changePercent >= 0 ? "#10b981" : "#ef4444",
    changeDirection: changePercent >= 0 ? "up" : "down",
    changePercent: Math.abs(changePercent).toFixed(2),
    alertMessage: `Volume is ${volumePercent.toFixed(0)}% of its 10-day average (threshold ${condition === "greater" ? ">" : "<"} ${threshold}%).`,
    volumeSpike: `${volumePercent.toFixed(0)}% of average volume`,
  });

  await transporter.sendMail({
    from: {
      name: "MarketPilot Volume Alerts",
      address: process.env.NODEMAILER_EMAIL!,
    },
    to: email,
    subject: `${symbol} volume alert: ${volumePercent.toFixed(0)}% of average`,
    text: `${symbol} volume is ${volumePercent.toFixed(0)}% of its 10-day average.`,
    html,
  });
}
