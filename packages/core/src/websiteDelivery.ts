type Publication = { releaseId: string; target: string; mode: string; status: string };

export function websitePublicationIsLive(publication: Publication) {
  if (["download", "developer_handoff"].includes(publication.mode)) return false;
  return publication.status === "published"
    || publication.target === "static_html" && publication.mode === "sftp" && publication.status === "completed";
}

export function websiteHandoffIsComplete(publications: Publication[], releaseId: string | null | undefined) {
  return Boolean(releaseId && publications.some(publication => publication.releaseId === releaseId
    && publication.target === "static_html" && ["download", "developer_handoff"].includes(publication.mode)
    && publication.status === "completed"));
}
