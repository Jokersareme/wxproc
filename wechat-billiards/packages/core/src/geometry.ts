import { TableGeometry } from "../../../third_party/billiards/src/view/tablegeometry";
import { R } from "../../../third_party/billiards/src/model/physics/constants";

export function tableDimensions() {
  return {
    ballRadius: R,
    halfWidth: TableGeometry.tableX,
    halfHeight: TableGeometry.tableY,
    outerHalfWidth: TableGeometry.X,
    outerHalfHeight: TableGeometry.Y,
  };
}
