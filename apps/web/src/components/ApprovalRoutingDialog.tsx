import { useState } from "react";
import { api } from "../api.js";

export type ApprovalRoute = "self_approve" | "send_to_team";

type RouteState = {
  projectId: string;
  subject: string;
  preference: ApprovalRoute | null;
  approvalMode: "solo" | "team";
  resolve: (route: ApprovalRoute | null) => void;
};

type RouteResponse = {
  approvalMode: "solo" | "team";
  preference: ApprovalRoute | null;
  needsChoice: boolean;
  canSelfApprove: boolean;
  workspaceType: string;
};

export function useApprovalRouting() {
  const [pending, setPending] = useState<RouteState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const chooseApprovalRoute = async (projectId: string, subject: string): Promise<ApprovalRoute | null> => {
    const route = await api.get<RouteResponse>(`/api/projects-v2/${projectId}/approval-route`);
    if (route.workspaceType === "personal") return "self_approve";
    if (!route.canSelfApprove) return route.approvalMode === "team" ? "send_to_team" : null;
    if (route.preference === "self_approve") return route.preference;
    if (route.preference === "send_to_team" && route.approvalMode === "team") return route.preference;
    return new Promise((resolve) => {
      setError("");
      setPending({ projectId, subject, preference: route.preference, approvalMode: route.approvalMode, resolve });
    });
  };

  const close = () => {
    pending?.resolve(null);
    setPending(null);
    setBusy("");
    setError("");
  };

  const saveChoice = async (preference: ApprovalRoute) => {
    if (!pending) return;
    setBusy(preference);
    setError("");
    try {
      await api.patch(`/api/projects-v2/${pending.projectId}/approval-route`, { preference });
      if (preference === "send_to_team" && pending.approvalMode === "solo") {
        pending.resolve(null);
        setPending(null);
        window.location.assign("/workspace?tab=teams");
        return;
      }
      pending.resolve(preference);
      setPending(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The approval route could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const approvalRouteDialog = pending ? <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-route-title">
    <button type="button" className="absolute inset-0" aria-label="Close approval choice" onClick={close} />
    <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="border-b bg-gradient-to-r from-indigo-50 via-white to-emerald-50 px-6 py-5">
        <div className="text-xs font-black uppercase tracking-wide text-indigo-700">Project approval</div>
        <h2 id="approval-route-title" className="mt-1 text-xl font-black text-slate-950">Choose the approval path once</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{pending.approvalMode === "solo" ? "Only your account can currently approve work in this agency workspace." : "Your agency has another approver available. Choose whether this project should use team approval or owner approval."}</p>
      </div>
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">Work being reviewed</div>
          <p className="mt-1 text-sm font-bold text-slate-900">{pending.subject}</p>
        </div>
        <p className="mt-5 text-base font-bold text-slate-950">Do you want to send project work to someone else for approval?</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{pending.preference === "send_to_team" && pending.approvalMode === "solo" ? "This project is set to team approval, but no other approver is available. Invite someone or switch the project to individual approval." : pending.approvalMode === "team" ? "Choose Yes to send reviewed work to the available team approver. Choose No to approve your own reviewed work immediately. SENuke AI will remember this choice for the project." : "Choose Yes to invite an approver. Choose No to approve your own reviewed work immediately. SENuke AI will remember this choice for the project."}</p>
        {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
        <button type="button" disabled={Boolean(busy)} onClick={close} className="rounded-lg border bg-white px-4 py-2.5 text-sm font-bold text-slate-600">Cancel</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void saveChoice("self_approve")} className="rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-black text-emerald-700 disabled:opacity-50">{busy === "self_approve" ? "Saving…" : "No — approve it myself"}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void saveChoice("send_to_team")} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy === "send_to_team" ? "Saving…" : pending.approvalMode === "team" ? "Yes — send to team" : "Yes — invite an approver"}</button>
      </div>
    </div>
  </div> : null;

  return { chooseApprovalRoute, approvalRouteDialog };
}
