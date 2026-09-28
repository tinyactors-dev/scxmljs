import { Component, CUSTOM_ELEMENTS_SCHEMA, Input, type OnDestroy, type OnInit, signal } from "@angular/core";
import { createSession, type SCXMLSession } from "@tinyactors/scxmljs/trusted";
import "@tinyactors/scxmljs/explorer";
import "@tinyactors/scxmljs/view";

@Component({
  selector: "app-chart",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <scxml-view src="/charts/traffic-light.scxml" trusted (scxml-load)="loaded($event)"></scxml-view>
    <scxml-explorer [session]="session()"></scxml-explorer>
  `,
})
export class ChartComponent implements OnInit, OnDestroy {
  @Input({ required: true }) source!: string;
  session = signal<SCXMLSession | undefined>(undefined);

  async ngOnInit() {
    const s = await createSession(this.source);
    this.session.set(s);
    s.start();
  }
  ngOnDestroy() {
    this.session()?.dispose();
  }
  loaded(e: Event) {
    console.log((e as CustomEvent).detail);
  }
}
