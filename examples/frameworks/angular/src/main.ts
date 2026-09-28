import { Component, provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { PLAYER } from "./app/chart";
import { ChartComponent } from "./app/chart.component"; // the documented snippet, verbatim

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ChartComponent],
  template: `<h1>Angular</h1><app-chart [source]="player" />`,
})
class AppComponent {
  player = PLAYER;
}

bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection()] }).catch((e) => console.error(e));
