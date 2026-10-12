import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  FeatureFlag,
  Modules,
} from "@medusajs/framework/utils"
import { createUsersWorkflow } from "@medusajs/medusa/core-flows"
import { setFloofCors } from "../../../lib/cors"

const AUTH_PROVIDER = "emailpass"

function requireAdmin(req: MedusaRequest, res: MedusaResponse): boolean {
  const expected = process.env.FLOOF_ADMIN_KEY || ""
  const provided = (req.headers["x-floof-admin-key"] as string) || ""

  if (!expected) {
    res.status(503).json({ error: "FLOOF_ADMIN_KEY is not configured on the backend" })
    return false
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized — set x-floof-admin-key" })
    return false
  }
  return true
}

async function resolveSuperAdminRoleIds(container: MedusaRequest["scope"]): Promise<string[]> {
  if (!FeatureFlag.isFeatureEnabled("rbac")) {
    return []
  }
  const rbacService = container.resolve(Modules.RBAC)
  const superAdminRoles = await rbacService.listRbacRoles({
    id: "role_super_admin",
  })
  return superAdminRoles.length > 0 ? [superAdminRoles[0].id] : []
}

/**
 * POST /floof/bootstrap-admin
 *
 * TEMPORARY: create or reset an admin user (same outcome as `medusa user`).
 */
export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  res.status(204).end()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return

  const body = (req.body || {}) as Record<string, unknown>
  const email = String(body.email || "").trim().toLowerCase()
  const password = String(body.password || "")

  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "email is required" })
    return
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" })
    return
  }

  const container = req.scope
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const userModule = container.resolve(Modules.USER)
  const authService = container.resolve(Modules.AUTH)

  try {
    const userRoles = await resolveSuperAdminRoleIds(container)

    const existingUsers = await userModule.listUsers({ email })
    let userCreated = false
    let user = existingUsers[0]

    if (!user) {
      const { result: users } = await createUsersWorkflow(container).run({
        input: {
          users: [
            {
              email,
              roles: userRoles,
            },
          ],
        },
      })
      user = users[0]
      userCreated = true
    }

    const { data: existingProviders } = await query.graph({
      entity: "provider_identity",
      fields: ["id", "auth_identity_id"],
      filters: {
        entity_id: email,
        provider: AUTH_PROVIDER,
      },
    })

    let identityCreated = false
    let authIdentityId: string | undefined

    if (existingProviders?.[0]) {
      const updateResult = await authService.updateProvider(AUTH_PROVIDER, {
        entity_id: email,
        password,
      })
      if (!updateResult.success) {
        res.status(500).json({
          error: updateResult.error || "Failed to update auth identity password",
        })
        return
      }
      authIdentityId =
        updateResult.authIdentity?.id ??
        (existingProviders[0].auth_identity_id as string)
    } else {
      const registerResult = await authService.register(AUTH_PROVIDER, {
        body: {
          email,
          password,
        },
      })
      if (registerResult.error || !registerResult.authIdentity?.id) {
        res.status(500).json({
          error: registerResult.error || "Failed to register auth identity",
        })
        return
      }
      authIdentityId = registerResult.authIdentity.id
      identityCreated = true
    }

    if (!authIdentityId) {
      res.status(500).json({ error: "Auth identity id missing after bootstrap" })
      return
    }

    await authService.updateAuthIdentities({
      id: authIdentityId,
      app_metadata: {
        user_id: user.id,
      },
    })

    res.status(userCreated ? 201 : 200).json({
      ok: true,
      user_id: user.id,
      userCreated,
      identityCreated,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bootstrap admin failed"
    console.error("[floof/bootstrap-admin]", e)
    res.status(500).json({ error: message })
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  setFloofCors(req, res)
  if (!requireAdmin(req, res)) return
  res.json({
    endpoint: "POST /floof/bootstrap-admin",
    auth: "x-floof-admin-key",
    temporary: true,
    body: {
      email: "admin@example.com",
      password: "min 8 characters",
    },
    response: {
      ok: true,
      user_id: "user_…",
      userCreated: true,
      identityCreated: true,
    },
  })
}
