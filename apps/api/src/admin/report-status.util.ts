import { ReportStatus } from './dto/admin.dto';

/**
 * Reports are stored with lowercase statuses (pending, reviewed, resolved, dismissed)
 * by the moderation module. The admin API speaks uppercase ReportStatus values,
 * so map between the two representations.
 */
export const REPORT_STATUS_TO_DB: Record<ReportStatus, string> = {
  [ReportStatus.PENDING]: 'pending',
  [ReportStatus.REVIEWING]: 'reviewed',
  [ReportStatus.RESOLVED]: 'resolved',
  [ReportStatus.REJECTED]: 'dismissed',
};

export const REPORT_STATUS_FROM_DB: Record<string, ReportStatus> = {
  pending: ReportStatus.PENDING,
  reviewed: ReportStatus.REVIEWING,
  resolved: ReportStatus.RESOLVED,
  dismissed: ReportStatus.REJECTED,
};

/**
 * DB values matching an API report status (both legacy uppercase and lowercase)
 */
export function reportStatusValues(status: ReportStatus): string[] {
  return [REPORT_STATUS_TO_DB[status], status];
}

export function normalizeReportStatus(status: string): ReportStatus {
  return REPORT_STATUS_FROM_DB[status?.toLowerCase()] ?? (status?.toUpperCase() as ReportStatus);
}
