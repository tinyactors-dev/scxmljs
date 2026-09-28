import type { ScxmlExplorer } from "@tinyactors/scxmljs/explorer";
import type { ScxmlView, ViewLoadDetail } from "@tinyactors/scxmljs/view";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "scxml-view": React.HTMLAttributes<ScxmlView> & {
        src?: string;
        trusted?: boolean;
        "onscxml-load"?: (e: CustomEvent<ViewLoadDetail>) => void;
      };
      "scxml-explorer": React.HTMLAttributes<ScxmlExplorer> & { session?: ScxmlExplorer["session"] };
    }
  }
}
