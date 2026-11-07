import { View, div } from "gpui-kit";
import { run, spaces, theme } from "herdr";

export default class MissionControlLauncher extends View {
  render() {
    const colors = theme();

    return div()
      .size_full()
      .p(6)
      .child(
        div()
          .id("open-mission-control")
          .size_full()
          .flex()
          .items_center()
          .px(12)
          .rounded(6)
          .bg(colors.surface)
          .text_color(colors.foreground)
          .text_size(13)
          .hover((style) => style.bg(colors.hover))
          .on_click(() => {
            const space = spaces().find(space => space.active);
            if (!space) return;
            run("tab.new", {
              name: "Mission Control",
              space: space.id,
              mod: "mission-control",
              props: { spaceId: space.id },
            });
          })
          .child("Mission Control"),
      );
  }
}
