import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15

/*
 ScoreView: shows stems as staff rows + playback timeline.
 Notation rendering: QtQuick Canvas (port of notation.js logic).
 Phase 1 stub — full Canvas renderer TBD.
*/
Item {
    property var job: null

    ScrollView {
        anchors.fill: parent
        clip: true

        Column {
            width: parent.width
            spacing: 0

            Repeater {
                model: job ? job.stems : []

                Rectangle {
                    width: parent.width
                    height: 90
                    color: index % 2 === 0 ? "#0f1117" : "#111520"

                    Row {
                        anchors { verticalCenter: parent.verticalCenter; left: parent.left; leftMargin: 16 }
                        spacing: 12

                        Rectangle {
                            width: 4; height: 60; radius: 2
                            color: "#60a5fa"  // TODO: map modelData.color
                        }

                        Column {
                            spacing: 4
                            anchors.verticalCenter: parent.verticalCenter
                            Label { text: modelData.name;       color: "#e2e8f0"; font.pixelSize: 13; font.weight: Font.Medium }
                            Label { text: modelData.instrument; color: "#64748b"; font.pixelSize: 11 }
                            Label { text: modelData.midi + " notes"; color: "#475569"; font.pixelSize: 10 }
                        }

                        // Staff canvas — notation rendered here
                        Canvas {
                            id: staffCanvas
                            width: 600
                            height: 80
                            anchors.verticalCenter: parent.verticalCenter
                            // TODO: port buildMeasuresFromMidi + drawNote to QtQuick Canvas
                            onPaint: {
                                const ctx = getContext("2d")
                                ctx.clearRect(0, 0, width, height)
                                ctx.strokeStyle = "#334155"
                                ctx.lineWidth = 1
                                for (let i = 0; i < 5; i++) {
                                    const y = 20 + i * 9
                                    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
