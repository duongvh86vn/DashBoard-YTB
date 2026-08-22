import { z } from "zod";

export const VideoMonitorTierSchema = z.enum(["HOT", "WARM", "OLD_HOT", "PINNED", "ARCHIVED"]);
export type VideoMonitorTier = z.infer<typeof VideoMonitorTierSchema>;

export const VideoAvailabilitySchema = z.enum(["AVAILABLE", "UNAVAILABLE"]);
export type VideoAvailability = z.infer<typeof VideoAvailabilitySchema>;
