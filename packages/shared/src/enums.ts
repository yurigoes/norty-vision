export const AppointmentStatus = {
  Pending: "pending",
  Confirmed: "confirmed",
  Rescheduled: "rescheduled",
  Canceled: "canceled",
  NoShow: "no_show",
  Attended: "attended",
  InProgress: "in_progress",
} as const;
export type AppointmentStatus =
  (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const IntentClass = {
  Confirm: "confirm",
  Reschedule: "reschedule",
  Cancel: "cancel",
  Question: "question",
  OptOut: "opt_out",
  Unknown: "unknown",
} as const;
export type IntentClass = (typeof IntentClass)[keyof typeof IntentClass];

export const MessageChannel = {
  Whatsapp: "whatsapp",
  Sms: "sms",
  Email: "email",
  Push: "push",
  Internal: "internal",
} as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

export const Role = {
  Owner: "owner",
  Admin: "admin",
  Manager: "manager",
  Recepcao: "recepcao",
  Medico: "medico",
  Vendedor: "vendedor",
  Readonly: "readonly",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PermissionScope = {
  None: "none",
  Self: "self",
  Store: "store",
  Org: "org",
  Platform: "platform",
} as const;
export type PermissionScope =
  (typeof PermissionScope)[keyof typeof PermissionScope];
