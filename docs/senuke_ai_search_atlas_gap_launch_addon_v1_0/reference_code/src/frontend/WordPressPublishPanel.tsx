export function WordPressPublishPanel({ connected }: { connected: boolean }) {
  return <section>
    <h2>WordPress Publishing</h2>
    {connected ? <button>Create WordPress Draft</button> : <div><p>Direct publishing is not connected yet. Export or connect WordPress.</p><button>Export HTML</button><button>Connect WordPress</button></div>}
  </section>;
}
