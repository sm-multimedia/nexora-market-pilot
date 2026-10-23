import { Schema, model, models, type Document, type Model } from "mongoose";

export interface UserAlertDocument extends Document {
  userId: string;
  symbol: string;
  company: string;
  alertName: string;
  kind: AlertKind;
  condition: AlertCondition;
  threshold: number;
  frequency: AlertFrequency;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  lastTriggeredValue?: number;
}

const UserAlertSchema = new Schema<UserAlertDocument>(
  {
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    company: { type: String, required: true, trim: true },
    alertName: { type: String, required: true, trim: true, maxlength: 80 },
    kind: { type: String, enum: ["price", "volume"], required: true },
    condition: { type: String, enum: ["greater", "less"], required: true },
    threshold: { type: Number, required: true, min: 0 },
    frequency: {
      type: String,
      enum: ["minute", "hour", "day"],
      default: "day",
    },
    isActive: { type: Boolean, default: true, index: true },
    lastTriggeredAt: { type: Date, default: null },
    lastTriggeredValue: { type: Number },
  },
  { timestamps: true },
);

UserAlertSchema.index({ userId: 1, isActive: 1 });

export const UserAlert: Model<UserAlertDocument> =
  (models?.UserAlert as Model<UserAlertDocument>) ||
  model<UserAlertDocument>("UserAlert", UserAlertSchema);
