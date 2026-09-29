import { CameraSourceType } from '@prisma/client';
import { ICameraAdapter } from './camera.types';
import { WebcamAdapter } from './adapters/webcam.adapter';
import { RtspAdapter } from './adapters/rtsp.adapter';
import { SmartCameraAdapter } from './adapters/smart-camera.adapter';

export class CameraAdapterFactory {
  public static create(sourceType: CameraSourceType, cameraId: string): ICameraAdapter {
    switch (sourceType) {
      case CameraSourceType.WEBCAM:
        return new WebcamAdapter(cameraId);
      case CameraSourceType.RTSP:
        return new RtspAdapter(cameraId);
      case CameraSourceType.SMART_CAMERA:
        return new SmartCameraAdapter(cameraId);
      default:
        throw new Error(`Unsupported camera source type: ${sourceType}`);
    }
  }
}
