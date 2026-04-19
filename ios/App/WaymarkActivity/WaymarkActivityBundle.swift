import SwiftUI
import WidgetKit

@main
struct WaymarkActivityBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            WaymarkActivityWidget()
        }
    }
}
