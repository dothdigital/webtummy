import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, startImpersonation } from "../api.js";
import type { AdminUser, BillingPlan } from "../types.js";
import { ActionIconButton, Button, Card, Input } from "../components/ui.js";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", year: "numeric" }).format(new Date(value));
}

function effectiveRole(roles: string[]) {
  if (roles.includes("owner") || roles.includes("admin")) return "admin";
  if (roles.includes("manager") || roles.includes("approver")) return "manager";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("client_viewer")) return "client_viewer";
  return "viewer";
}

function effectiveRoleLabel(roles: string[]) {
  const role = roles.length === 1 && ["admin", "manager", "editor", "viewer", "client_viewer"].includes(roles[0]) ? roles[0] : effectiveRole(roles);
  if (role === "admin") return "Owner/Admin";
  if (role === "manager") return "Manager/Approver";
  if (role === "client_viewer") return "Client Viewer";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function dateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function money(cents: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

function isLegacyActiveTrial(user: AdminUser) {
  const client = user.client;
  return Boolean(client && client.aiSubscriptionStatus === "active" && client.subscriptionSource === "trial" && !client.trialEndsAt && !client.manualAccessEndsAt);
}

function trialEndLabel(user: AdminUser) {
  if (isLegacyActiveTrial(user)) return "Not set (legacy active)";
  return formatDate(user.client?.trialEndsAt);
}

function billingState(user: AdminUser) {
  const client = user.client;
  if (!client) return { label: "Internal", detail: "No subscription", className: "border-slate-200 bg-slate-50 text-slate-600" };
  const now = new Date();
  if (isLegacyActiveTrial(user)) return { label: "legacy active", detail: "no trial end set", className: "border-amber-200 bg-amber-50 text-amber-800" };
  if (client.aiSubscriptionStatus === "active") return { label: "active", detail: client.subscriptionSource || "commercial", className: "border-green-200 bg-green-50 text-green-700" };
  if (client.aiSubscriptionStatus === "trialing") {
    const active = Boolean(client.trialEndsAt && new Date(client.trialEndsAt) > now);
    return { label: active ? "trial active" : "trial expired", detail: active ? `ends ${formatDate(client.trialEndsAt)}` : "upgrade required", className: active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-red-200 bg-red-50 text-red-700" };
  }
  if (client.aiSubscriptionStatus === "offline") {
    const active = Boolean(client.manualAccessEndsAt && new Date(client.manualAccessEndsAt) > now);
    return { label: active ? "offline active" : "offline expired", detail: active ? `ends ${formatDate(client.manualAccessEndsAt)}` : "upgrade required", className: active ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700" };
  }
  return { label: "expired", detail: client.aiSubscriptionStatus, className: "border-red-200 bg-red-50 text-red-700" };
}

function sourceLabel(user: AdminUser) {
  const client = user.client;
  if (!client) return "-";
  if (isLegacyActiveTrial(user)) return "legacy trial";
  if (client.subscriptionSource && client.subscriptionSource !== "trial") return client.subscriptionSource;
  if (client.aiSubscriptionStatus === "trialing") return "trial";
  if (client.aiSubscriptionStatus === "offline") return "offline";
  if (client.aiSubscriptionStatus === "active") return client.subscriptionSource || "commercial";
  return "-";
}

export default function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [planFilter, setPlanFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ type: "details" | "edit" | "password" | "subscription" | "rbac"; user: AdminUser } | null>(null);
  const [password, setPassword] = useState("");
  const [trialDays, setTrialDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [duration, setDuration] = useState<"monthly" | "yearly">("monthly");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [autoRenew, setAutoRenew] = useState(false);
  const [offlineExpiry, setOfflineExpiry] = useState(() => dateInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  const [message, setMessage] = useState<string | null>(null);

  const planByCode = useMemo(() => new Map(plans.map((plan) => [plan.code, plan])), [plans]);
  const filteredUsers = useMemo(() => users.filter((user) => planFilter === "all" || user.client?.plan === planFilter), [planFilter, users]);

  const load = async () => {
    setLoading(true);
    try {
      const [userResult, planResult] = await Promise.all([
        api.get<{ users: AdminUser[] }>("/api/users"),
        api.get<{ plans: BillingPlan[] }>("/api/billing/plans"),
      ]);
      setUsers(userResult.users);
      setPlans(planResult.plans);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const updateUser = (updated: AdminUser) => {
    setUsers((current) => current.map((item) => {
      if (item.id === updated.id) return { ...updated, memberships: updated.memberships ?? item.memberships };
      if (updated.clientId && item.clientId === updated.clientId && item.client) return { ...item, client: updated.client };
      return item;
    }));
    setModal((current) => {
      if (!current) return current;
      if (current.user.id === updated.id) return { ...current, user: updated };
      if (updated.clientId && current.user.clientId === updated.clientId && current.user.client) return { ...current, user: { ...current.user, client: updated.client } };
      return current;
    });
  };

  const patchUser = async (user: AdminUser, path: string, body: unknown, success: string) => {
    setBusyId(user.id);
    setMessage(null);
    try {
      const result = await api.patch<{ user: AdminUser }>(path, body);
      updateUser(result.user);
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const verify = (user: AdminUser) => patchUser(user, `/api/users/${user.id}/verify-email`, {}, `${user.email} is now verified.`);
  const setActive = (user: AdminUser, isActive: boolean) => patchUser(user, `/api/users/${user.id}/active`, { isActive }, `${user.email} ${isActive ? "enabled" : "disabled"}.`);
  const changePlan = (user: AdminUser, plan: string) => patchUser(user, `/api/users/${user.id}/plan`, { plan }, `${user.client?.name ?? user.email} moved to ${planByCode.get(plan)?.name ?? plan}.`);
  const updateBillingAccess = (user: AdminUser, body: unknown, success: string) => patchUser(user, `/api/users/${user.id}/billing-access`, body, success);

  const updateMembershipRole = async (membershipId: string, role: string) => {
    setBusyId(membershipId); setMessage(null);
    try { await api.patch(`/api/users/memberships/${membershipId}/role`, { role }); setMessage("Workspace role updated."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };

  const updateMembershipStatus = async (membershipId: string, status: string) => {
    setBusyId(membershipId); setMessage(null);
    try { await api.patch(`/api/users/memberships/${membershipId}/status`, { status }); setMessage("Workspace membership updated."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };

  const makePrimaryOwner = async (workspaceId: string, membershipId: string) => {
    setBusyId(membershipId); setMessage(null);
    try { await api.patch(`/api/users/workspaces/${workspaceId}/primary-owner`, { membershipId }); setMessage("Primary Owner updated."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };

  const updateApprovalPolicy = async (workspaceId: string, allowManagerSelfApproval: boolean) => {
    setBusyId(workspaceId); setMessage(null);
    try { await api.patch(`/api/users/workspaces/${workspaceId}/approval-policy`, { allowManagerSelfApproval }); setMessage("Workspace approval policy updated."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };

  const changePassword = async (event: FormEvent, user: AdminUser) => {
    event.preventDefault();
    await patchUser(user, `/api/users/${user.id}/password`, { password }, `Password changed for ${user.email}.`);
    setPassword("");
    setModal(null);
  };

  const recordOfflinePayment = async (event: FormEvent, user: AdminUser) => {
    event.preventDefault();
    setBusyId(user.id);
    setMessage(null);
    try {
      const result = await api.post<{ user: AdminUser }>(`/api/users/${user.id}/offline-payment`, {
        amountCents: Math.round(Number(amount || 0) * 100),
        method,
        duration,
        reference,
        notes,
        autoRenew,
      });
      updateUser(result.user);
      setAmount("");
      setMethod("");
      setReference("");
      setNotes("");
      setMessage(`Offline payment recorded for ${user.client?.name ?? user.email}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">User Management</h1>
        <p className="text-sm text-charcoal-400">Manage accounts, workspace roles, membership access, plans, subscriptions, and payment history.</p>
      </div>
      {message && <Card className="p-4 text-sm text-charcoal-600">{message}</Card>}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-charcoal-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-semibold text-charcoal-700">Users ({filteredUsers.length}{planFilter === "all" ? "" : ` of ${users.length}`})</div>
          <label className="flex items-center gap-2 text-sm text-charcoal-600">
            <span className="font-medium">Filter plan</span>
            <select value={planFilter} onChange={(event) => setPlanFilter(event.target.value)} className="min-w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
              <option value="all">All plans</option>
              {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}
            </select>
          </label>
        </div>
        {loading ? <div className="p-6 text-sm text-charcoal-400">Loading users...</div> : filteredUsers.length === 0 ? <div className="p-6 text-sm text-charcoal-400">No users found.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Name</th>
                  <th className="px-5 py-2">Email</th>
                  <th className="px-5 py-2">Business Name</th>
                  <th className="px-5 py-2">Role</th>
                  <th className="px-5 py-2">Subscription Status</th>
                  <th className="px-5 py-2">Trial Ends</th>
                  <th className="px-5 py-2">Source</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const status = billingState(user);
                  return (
                    <tr key={user.id} className="border-t border-charcoal-50 align-top">
                        <td className="px-5 py-3 font-medium text-charcoal-800">{user.name ?? "-"}</td>
                        <td className="px-5 py-3 text-charcoal-600">{user.email}</td>
                        <td className="px-5 py-3 text-charcoal-600">{user.client?.name ?? "-"}</td>
                        <td className="px-5 py-3 text-charcoal-600">{user.role === "super_admin" ? "Super Admin" : (user.memberships ?? []).map((membership) => effectiveRoleLabel(membership.roles.map((item) => item.role))).join(", ") || user.role.replace("_", " ")}</td>
                        <td className="px-5 py-3">
                          <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${status.className}`}>{status.label}</div>
                          <div className="mt-1 text-xs text-charcoal-400">{status.detail}</div>
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">{trialEndLabel(user)}</td>
                        <td className="px-5 py-3 capitalize text-charcoal-600">{sourceLabel(user)}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-nowrap justify-end gap-2 whitespace-nowrap">
                            <ActionIconButton icon="details" label="Details" onClick={() => setModal({ type: "details", user })} />
                            {user.role !== "super_admin" && <ActionIconButton icon="edit" label="Manage workspace roles" onClick={() => setModal({ type: "rbac", user })} />}
                            {user.clientId && <ActionIconButton icon="save" label="Manage subscription" onClick={() => setModal({ type: "subscription", user })} />}
                            {user.clientId && <ActionIconButton icon="edit" label="Edit user and plan" onClick={() => setModal({ type: "edit", user })} disabled={busyId === user.id} />}
                            {user.clientId && <ActionIconButton icon="project" label="View projects" onClick={() => { startImpersonation(user.clientId!, user.name ?? user.email); navigate("/projects"); }} />}
                            <ActionIconButton icon={user.isActive ? "disable" : "enable"} label={user.isActive ? "Disable account" : "Enable account"} onClick={() => setActive(user, !user.isActive)} disabled={busyId === user.id} />
                            <ActionIconButton icon="key" label="Change password" onClick={() => { setModal({ type: "password", user }); setPassword(""); }} disabled={busyId === user.id} />
                            {!user.emailVerifiedAt && <ActionIconButton icon="verify" label="Verify email" onClick={() => verify(user)} disabled={busyId === user.id} />}
                          </div>
                        </td>
                      </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {modal && (
        <Modal title={modal.type === "rbac" ? `Workspace Access — ${modal.user.name ?? modal.user.email}` : modal.type === "subscription" ? `Manage Subscription — ${modal.user.name ?? modal.user.email}` : modal.type === "password" ? `Change Password — ${modal.user.name ?? modal.user.email}` : modal.type === "edit" ? `Edit User — ${modal.user.name ?? modal.user.email}` : `User Details — ${modal.user.name ?? modal.user.email}`} onClose={() => setModal(null)}>
          {modal.type === "details" && (
            <div className="grid gap-4 text-sm md:grid-cols-3">
              <Detail label="User ID" value={modal.user.id} /><Detail label="Client ID" value={modal.user.clientId ?? "-"} /><Detail label="User created" value={formatDateTime(modal.user.createdAt)} />
              <Detail label="Last login" value={formatDateTime(modal.user.lastLoginAt)} /><Detail label="Plan" value={modal.user.client?.plan ? (planByCode.get(modal.user.client.plan)?.name ?? modal.user.client.plan) : "-"} /><Detail label="Contact Email" value={modal.user.client?.contactEmail ?? "-"} />
              <Detail label="Client active" value={modal.user.client?.isActive ? "Yes" : modal.user.client ? "No" : "-"} /><Detail label="Email verified" value={modal.user.emailVerifiedAt ? formatDateTime(modal.user.emailVerifiedAt) : "No"} /><Detail label="Subscription status" value={modal.user.client?.aiSubscriptionStatus ?? "-"} />
              <Detail label="Trial started" value={formatDate(modal.user.client?.trialStartedAt)} /><Detail label="Trial ends" value={trialEndLabel(modal.user)} /><Detail label="Grace end" value={formatDate(modal.user.client?.graceEndsAt)} />
              <Detail label="Sub ends" value={formatDate(modal.user.client?.manualAccessEndsAt)} /><Detail label="Source" value={sourceLabel(modal.user)} /><Detail label="Business" value={modal.user.client?.name ?? "-"} />
            </div>
          )}
          {modal.type === "edit" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Detail label="Name" value={modal.user.name ?? "-"} />
                <Detail label="Email" value={modal.user.email} />
                <Detail label="Business" value={modal.user.client?.name ?? "-"} />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Plan</span>
                  <select value={modal.user.client?.plan ?? ""} onChange={(event) => { void changePlan(modal.user, event.target.value); setModal(null); }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                    {plans.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setActive(modal.user, !modal.user.isActive)} disabled={busyId === modal.user.id}>{modal.user.isActive ? "Disable account" : "Enable account"}</Button>
                {!modal.user.emailVerifiedAt && <Button onClick={() => verify(modal.user)} disabled={busyId === modal.user.id}>Verify email</Button>}
              </div>
            </div>
          )}
          {modal.type === "rbac" && (
            <div className="space-y-4">
              {(users.find((item) => item.id === modal.user.id)?.memberships ?? modal.user.memberships ?? []).map((membership) => {
                const primaryOwner = membership.workspace.ownerUserId === membership.userId;
                const currentRole = effectiveRole(membership.roles.map((item) => item.role));
                const allowedRoles = membership.workspace.workspaceType === "agency" ? ["admin", "manager", "editor", "viewer", "client_viewer"] : ["admin", "manager", "editor", "viewer"];
                const approvalPolicy = membership.workspace.autoApprovalPolicyJson && typeof membership.workspace.autoApprovalPolicyJson === "object" ? membership.workspace.autoApprovalPolicyJson as { allowManagerSelfApproval?: unknown } : {};
                return <Card key={membership.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold text-charcoal-900">{membership.workspace.name}</div><div className="mt-1 text-xs capitalize text-charcoal-500">{membership.workspace.workspaceType} workspace · {primaryOwner ? "Primary Owner" : "Member"}</div></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${membership.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{membership.status}</span></div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <label className="text-xs font-bold text-charcoal-600">Effective role<select disabled={primaryOwner || busyId === membership.id} value={currentRole} onChange={(event) => void updateMembershipRole(membership.id, event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{allowedRoles.map((role) => <option key={role} value={role}>{effectiveRoleLabel([role])}</option>)}</select></label>
                    <label className="text-xs font-bold text-charcoal-600">Membership status<select disabled={primaryOwner || busyId === membership.id} value={membership.status} onChange={(event) => void updateMembershipStatus(membership.id, event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option></select></label>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs"><Detail label="Projects" value={String(membership._count.projectAssignments)} /><Detail label="Tasks" value={String(membership._count.assignedTasks)} /><Detail label="Approvals" value={String(membership._count.approvalTasks)} /></div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <label className="flex items-start gap-2 text-xs text-charcoal-600"><input type="checkbox" checked={approvalPolicy.allowManagerSelfApproval === true} disabled={busyId === membership.workspace.id} onChange={(event) => void updateApprovalPolicy(membership.workspace.id, event.target.checked)} className="mt-0.5" /><span><b>Manager self-approval</b><span className="block text-charcoal-400">Allow Manager/Approver users to approve their own submitted work.</span></span></label>
                    {!primaryOwner && currentRole === "admin" && <Button variant="ghost" disabled={busyId === membership.id} onClick={() => void makePrimaryOwner(membership.workspace.id, membership.id)}>Make Primary Owner</Button>}
                  </div>
                  {primaryOwner && <p className="mt-3 text-xs text-amber-700">Transfer Primary Owner from the workspace before changing this user’s Owner/Admin role or status.</p>}
                </Card>;
              })}
              {!modal.user.memberships?.length && <p className="text-sm text-charcoal-500">This account has no workspace membership.</p>}
            </div>
          )}
          {modal.type === "password" && (
            <form onSubmit={(event) => { void changePassword(event, modal.user); }} className="space-y-4">
              <Input label="New password" type="password" value={password} onChange={setPassword} placeholder="Minimum 8 characters" />
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={busyId === modal.user.id || password.length < 8}>Save password</Button></div>
            </form>
          )}
          {modal.type === "subscription" && (
            <ManageSubscription user={modal.user} busy={busyId === modal.user.id} trialDays={trialDays} setTrialDays={setTrialDays} offlineExpiry={offlineExpiry} setOfflineExpiry={setOfflineExpiry} amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} duration={duration} setDuration={setDuration} reference={reference} setReference={setReference} notes={notes} setNotes={setNotes} autoRenew={autoRenew} setAutoRenew={setAutoRenew} updateBillingAccess={updateBillingAccess} recordOfflinePayment={recordOfflinePayment} />
          )}
        </Modal>
      )}
    </div>
  );
}

function ManageSubscription(props: {
  user: AdminUser; busy: boolean; trialDays: string; setTrialDays: (v: string) => void; offlineExpiry: string; setOfflineExpiry: (v: string) => void;
  amount: string; setAmount: (v: string) => void; method: string; setMethod: (v: string) => void; duration: "monthly" | "yearly"; setDuration: (v: "monthly" | "yearly") => void;
  reference: string; setReference: (v: string) => void; notes: string; setNotes: (v: string) => void; autoRenew: boolean; setAutoRenew: (v: boolean) => void;
  updateBillingAccess: (user: AdminUser, body: unknown, success: string) => Promise<void> | void; recordOfflinePayment: (event: FormEvent, user: AdminUser) => Promise<void>;
}) {
  const { user } = props;
  return (
    <div className="space-y-5">
      <div>
        <div className="text-lg font-bold text-charcoal-900">Manage Subscription — {user.name ?? user.email}</div>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
          <Detail label="Status" value={isLegacyActiveTrial(user) ? "legacy active" : (user.client?.aiSubscriptionStatus ?? "-")} /><Detail label="Source" value={sourceLabel(user)} /><Detail label="Trial End" value={trialEndLabel(user)} /><Detail label="Grace End" value={formatDate(user.client?.graceEndsAt)} />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <div className="font-semibold text-charcoal-900">Update Trial Period</div>
          <div className="mt-3 flex items-end gap-2"><div><label className="mb-1 block text-sm font-medium text-slate-600">Trial days</label><input type="number" min="1" max="365" value={props.trialDays} onChange={(event) => props.setTrialDays(event.target.value)} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></div><Button onClick={() => props.updateBillingAccess(user, { action: "extend_trial", days: Number(props.trialDays) }, `${user.client?.name ?? user.email} trial extended.`)} disabled={props.busy}>Update</Button></div>
          <div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => props.updateBillingAccess(user, { action: "offline_until", expiresAt: new Date(`${props.offlineExpiry}T23:59:59.000Z`).toISOString(), autoRenew: props.autoRenew }, `${user.client?.name ?? user.email} offline expiry updated.`)} disabled={props.busy}>Set offline until date</Button><input type="date" value={props.offlineExpiry} onChange={(event) => props.setOfflineExpiry(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></div>
        </Card>
        <Card className="p-4">
          <form onSubmit={(event) => props.recordOfflinePayment(event, user)}>
            <div className="font-semibold text-charcoal-900">Record Offline Payment</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="Amount" type="number" value={props.amount} onChange={props.setAmount} placeholder="Amount" />
              <Input label="Method" value={props.method} onChange={props.setMethod} placeholder="Method" />
              <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Duration</span><select value={props.duration} onChange={(event) => props.setDuration(event.target.value as "monthly" | "yearly")} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"><option value="monthly">monthly</option><option value="yearly">yearly</option></select></label>
              <Input label="Reference #" value={props.reference} onChange={props.setReference} placeholder="Reference #" />
              <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium text-slate-600">Notes</span><textarea value={props.notes} onChange={(event) => props.setNotes(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="Notes" /></label>
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm text-charcoal-700"><input type="checkbox" checked={props.autoRenew} onChange={(event) => props.setAutoRenew(event.target.checked)} className="mt-1 h-4 w-4 rounded border-charcoal-300" /><span><span className="font-semibold">Enable Auto-Renewal</span><br /><span className="text-charcoal-500">Auto-renewal will renew this offline subscription on the next renewal date.</span></span></label>
            <Button type="submit" className="mt-4" disabled={props.busy || !props.amount || !props.method}>Record payment</Button>
          </form>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 font-semibold text-charcoal-900">Payment History</div>
        <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-charcoal-400"><tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Duration</th><th className="px-4 py-2">Method</th><th className="px-4 py-2">Auto-Renewal</th><th className="px-4 py-2">Sub Ends</th><th className="px-4 py-2">Next Renewal</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Actions</th></tr></thead><tbody>{(user.client?.offlinePayments ?? []).length === 0 ? <tr><td colSpan={10} className="px-4 py-5 text-center text-charcoal-400">No offline payments recorded.</td></tr> : user.client!.offlinePayments.map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="px-4 py-2">{formatDate(payment.createdAt)}</td><td className="px-4 py-2">offline</td><td className="px-4 py-2">{money(payment.amountCents)}</td><td className="px-4 py-2">{payment.duration}</td><td className="px-4 py-2">{payment.method}</td><td className="px-4 py-2">{payment.autoRenew ? "Yes" : "No"}</td><td className="px-4 py-2">{formatDate(payment.subscriptionEndsAt)}</td><td className="px-4 py-2">{formatDate(payment.nextRenewalAt)}</td><td className="px-4 py-2">{payment.status}</td><td className="px-4 py-2 text-charcoal-400">-</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="text-lg font-bold text-charcoal-900">{title}</div>
          <ActionIconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{label}</div><div className="mt-1 break-words text-charcoal-700">{value}</div></div>;
}
