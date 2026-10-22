// Isolated component interaction tests. HTTP responses here are controlled fixtures,
// not hosted acceptance or proof of Auth/Vault/PostgREST integration.
import { createRoot, type Root } from "react-dom/client";
import { IssueConfirmation } from "../../src/components/doctor/issue-confirmation";
import { IssuedDocument } from "../../src/components/doctor/issued-document";
import type { Review, Lifecycle } from "../../src/lib/issuance/validation";
import type { DraftRecord } from "../../src/lib/drafts/validation";
import { PharmacyDashboard } from "../../src/components/pharmacy/pharmacy-dashboard";
let root: Root;
declare global {
  interface Window {
    renderIssuanceUI: (props: {
      review?: Review;
      record?: DraftRecord;
      initial?: Lifecycle;
    }) => void;
    printCount: number;
    renderPharmacyUI: (key: string) => void;
  }
}
window.printCount = 0;
window.print = () => {
  window.printCount++;
};
window.renderIssuanceUI = (props) => {
  root ??= createRoot(document.getElementById("root")!);
  root.render(
    props.review ? (
      <IssueConfirmation review={props.review} />
    ) : (
      <IssuedDocument
        record={props.record!}
        initial={props.initial!}
        doctorEmail="synthetic@example.invalid"
      />
    ),
  );
};
window.renderPharmacyUI = (key) => {
  root ??= createRoot(document.getElementById("root")!);
  root.render(
    <PharmacyDashboard key={key} pharmacyName="SYNTHETIC PHARMACY" />,
  );
};
