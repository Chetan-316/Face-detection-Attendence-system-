import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { StaffRole, PresenceState } from '@prisma/client';
import { testPrisma, resetTestDatabase } from './helpers/test-db';
import { createApp } from '../src/api/app';
import { tokenService } from '../src/api/auth/token.service';

describe('Resident Profile Photo API & Storage Tests', () => {
  let app: any;
  let adminToken: string;
  let wardenToken: string;
  let guardToken: string;
  let resident: any;
  let org: any;
  let hostel: any;

  // Minimal valid 1x1 JPEG buffer
  const sampleJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x80, 0xff, 0xd9,
  ]);

  beforeEach(async () => {
    await resetTestDatabase();
    app = createApp(testPrisma);

    org = await testPrisma.organization.create({
      data: { code: 'PHOTO_ORG', name: 'Photo Org' },
    });

    hostel = await testPrisma.hostel.create({
      data: { organizationId: org.id, code: 'PHOTO_HOSTEL', name: 'Photo Hostel' },
    });

    const admin = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        username: 'admin_photo',
        fullName: 'Admin Photo',
        passwordHash: 'dummy',
        role: StaffRole.ADMIN,
      },
    });

    const warden = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'warden_photo',
        fullName: 'Warden Photo',
        passwordHash: 'dummy',
        role: StaffRole.WARDEN,
      },
    });

    const guard = await testPrisma.user.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        username: 'guard_photo',
        fullName: 'Guard Photo',
        passwordHash: 'dummy',
        role: StaffRole.GUARD,
      },
    });

    adminToken = tokenService.generateToken({
      sub: admin.id,
      organizationId: org.id,
      hostelId: null,
      role: StaffRole.ADMIN,
    }).token;

    wardenToken = tokenService.generateToken({
      sub: warden.id,
      organizationId: org.id,
      hostelId: hostel.id,
      role: StaffRole.WARDEN,
    }).token;

    guardToken = tokenService.generateToken({
      sub: guard.id,
      organizationId: org.id,
      hostelId: hostel.id,
      role: StaffRole.GUARD,
    }).token;

    resident = await testPrisma.resident.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        residentCode: 'STU-PHOTO-01',
        fullName: 'Rahul Patil',
        roomGroup: 'Room 203',
      },
    });
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows Warden to upload resident profile photo via base64 JSON', async () => {
    const res = await request(app)
      .post(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({
        imageBase64: sampleJpeg.toString('base64'),
      })
      .expect(200);

    expect(res.body.data.profilePhotoPath).toContain(`${resident.id}.jpg`);

    // Verify persisted in DB
    const updated = await testPrisma.resident.findUnique({ where: { id: resident.id } });
    expect(updated?.profilePhotoPath).toBe(res.body.data.profilePhotoPath);

    // Verify GET endpoint serves binary image with proper headers
    const getRes = await request(app)
      .get(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .expect(200);

    expect(getRes.headers['content-type']).toContain('image/jpeg');
    expect(getRes.body).toBeInstanceOf(Buffer);
    expect(getRes.body.length).toBe(sampleJpeg.length);
  });

  it('allows Admin to upload profile photo and delete profile photo', async () => {
    await request(app)
      .post(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        imageBase64: sampleJpeg.toString('base64'),
      })
      .expect(200);

    // Delete photo
    const delRes = await request(app)
      .delete(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(delRes.body.message).toContain('removed successfully');

    // DB field is null
    const updated = await testPrisma.resident.findUnique({ where: { id: resident.id } });
    expect(updated?.profilePhotoPath).toBeNull();

    // GET now returns 404
    await request(app)
      .get(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('forbids Guard from uploading or deleting profile photo (403)', async () => {
    await request(app)
      .post(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${guardToken}`)
      .send({
        imageBase64: sampleJpeg.toString('base64'),
      })
      .expect(403);

    await request(app)
      .delete(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${guardToken}`)
      .expect(403);
  });

  it('rejects invalid image data or corrupted format', async () => {
    const fakeBuffer = Buffer.from('This is clearly not a real image file! Just text.');

    const res = await request(app)
      .post(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({
        imageBase64: fakeBuffer.toString('base64'),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Invalid image format/i);
  });

  it('supports capture from camera snapshot and NEVER creates biometric face profile template', async () => {
    // Create test camera
    const camera = await testPrisma.camera.create({
      data: {
        organizationId: org.id,
        hostelId: hostel.id,
        name: 'Enrollment Desk Camera',
        sourceType: 'WEBCAM',
        role: 'GENERAL',
        isEnabled: true,
      },
    });

    const { CameraService } = await import('../src/modules/cameras/camera.service');
    const cameraService = new CameraService(testPrisma);
    // Mock captureSnapshot to return sampleJpeg
    vi.spyOn(cameraService, 'captureSnapshot').mockResolvedValue({
      cameraId: camera.id,
      timestamp: new Date(),
      sourceType: 'WEBCAM',
      format: 'image/jpeg',
      frameBuffer: sampleJpeg,
      width: 640,
      height: 480,
      sequence: 1,
    } as any);

    const appWithMockCam = createApp(testPrisma, { cameraService });

    const res = await request(appWithMockCam)
      .post(`/api/v1/residents/${resident.id}/profile-photo`)
      .set('Authorization', `Bearer ${wardenToken}`)
      .send({ cameraId: camera.id })
      .expect(200);

    expect(res.body.data.profilePhotoPath).toContain(`${resident.id}.jpg`);

    // Verify Part 39: Profile photo is visual only. ZERO face_profiles created, faceEnrollmentStatus unchanged!
    const faceProfiles = await testPrisma.faceProfile.findMany({ where: { residentId: resident.id } });
    expect(faceProfiles.length).toBe(0);

    const residentRecord = await testPrisma.resident.findUnique({ where: { id: resident.id } });
    expect(residentRecord?.faceEnrollmentStatus).toBe('NOT_ENROLLED');
  });
});
