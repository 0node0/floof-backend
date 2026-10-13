import type { MedusaContainer } from "@medusajs/framework/types"
import {
  maintainMugDesignProducts,
  type MaintainMugProductsInput,
  type MaintainMugProductsResult,
} from "./maintain-mug-products"

export type MugMaintenanceJobStatus = "queued" | "running" | "completed" | "failed"

export type MugMaintenanceJobRecord = {
  id: string
  status: MugMaintenanceJobStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  input: MaintainMugProductsInput
  result?: MaintainMugProductsResult
  error?: string
}

const jobs = new Map<string, MugMaintenanceJobRecord>()
const JOB_TTL_MS = 24 * 60 * 60 * 1000

function newJobId(): string {
  return `mug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function pruneOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    const t = Date.parse(job.finishedAt || job.createdAt)
    if (job.status === "completed" || job.status === "failed") {
      if (t < cutoff) jobs.delete(id)
    }
  }
}

export function getMugMaintenanceJob(jobId: string): MugMaintenanceJobRecord | null {
  pruneOldJobs()
  return jobs.get(jobId) ?? null
}

export function startMugMaintenanceJob(
  container: MedusaContainer,
  input: MaintainMugProductsInput
): MugMaintenanceJobRecord {
  pruneOldJobs()
  const id = newJobId()
  const record: MugMaintenanceJobRecord = {
    id,
    status: "queued",
    createdAt: new Date().toISOString(),
    input,
  }
  jobs.set(id, record)

  void runMugMaintenanceJob(container, id).catch((e: unknown) => {
    const job = jobs.get(id)
    if (!job) return
    job.status = "failed"
    job.finishedAt = new Date().toISOString()
    job.error = e instanceof Error ? e.message : String(e)
  })

  return record
}

async function runMugMaintenanceJob(container: MedusaContainer, jobId: string): Promise<void> {
  const job = jobs.get(jobId)
  if (!job) return
  job.status = "running"
  job.startedAt = new Date().toISOString()

  try {
    const result = await maintainMugDesignProducts(container, job.input)
    job.result = result
    job.status = "completed"
    job.finishedAt = new Date().toISOString()
  } catch (e: unknown) {
    job.status = "failed"
    job.finishedAt = new Date().toISOString()
    job.error = e instanceof Error ? e.message : String(e)
    throw e
  }
}
