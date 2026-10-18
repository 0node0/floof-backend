import { getApparelMaintenanceJob, type ApparelMaintenanceJobRecord } from "./apparel-maintenance-jobs"
import { getMugMaintenanceJob, type MugMaintenanceJobRecord } from "./mug-maintenance-jobs"
import {
  getOutkastGalleryJob,
  type OutkastGalleryJobRecord,
} from "./outkast-gallery-jobs"

export type MaintenanceJobRecord =
  | (MugMaintenanceJobRecord & { kind: "mug" })
  | (ApparelMaintenanceJobRecord & { kind: "apparel" })
  | (OutkastGalleryJobRecord & { kind: "gallery" })

export function getMaintenanceJob(jobId: string): MaintenanceJobRecord | null {
  const mug = getMugMaintenanceJob(jobId)
  if (mug) return { ...mug, kind: "mug" }
  const apparel = getApparelMaintenanceJob(jobId)
  if (apparel) return { ...apparel, kind: "apparel" }
  const gallery = getOutkastGalleryJob(jobId)
  if (gallery) return { ...gallery, kind: "gallery" }
  return null
}
