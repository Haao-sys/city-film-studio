// Set this after updating the camera pose; width is measured at the focus plane.
export function blendProjection(camera, focusDistance, width, parallel) {
  if (!(focusDistance>0 && width>0 && camera.near>0 && camera.far>camera.near && parallel>=0 && parallel<=1))
    throw Error('Invalid lens dimensions or parallel projection weight.');
  const m=1-parallel, base=focusDistance*parallel;
  const nearW=m*camera.near+base, farW=m*camera.far+base;
  const z=(nearW+farW)/(camera.near-camera.far);
  const scale=2*focusDistance/width;
  camera.projectionMatrix.set(scale,0,0,0, 0,scale*camera.aspect,0,0, 0,0,z,z*camera.near-nearW, 0,0,-m,base);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
