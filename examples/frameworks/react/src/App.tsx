import { useEffect, useState } from "react";
import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

export function Chart({ src }: { src: string }) {
  return <scxml-view src={src} trusted onscxml-load={(e) => console.log(e.detail.session)} />;
}

export function Explorer({ source }: { source: string }) {
  const [session, setSession] = useState<SCXMLSession>();
  useEffect(() => {
    let s: SCXMLSession | undefined;
    createSession(source).then((created) => {
      s = created;
      setSession(created);
      created.start();
    });
    return () => s?.dispose();
  }, [source]);
  return <scxml-explorer session={session} />;
}
