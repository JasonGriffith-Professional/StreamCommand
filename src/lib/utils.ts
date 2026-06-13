import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const QUEUE_LABELS: Record<string, string> = {
  ascend:   "Ascension Carry",
  t15maps:  "T15 XP Farm",
  groupup:  "Group Maps",
  bosshelp: "Boss Carry",
  campaign: "Campaign Help",
  quest:    "Quest Help",
};

export const QUEUE_COMMANDS: Record<string, string> = {
  ascend:   "!ascend",
  t15maps:  "!t15maps",
  groupup:  "!groupup",
  bosshelp: "!bosshelp",
  campaign: "!campaign",
  quest:    "!quest",
};
