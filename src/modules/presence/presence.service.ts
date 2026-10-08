import { PrismaClient, PresenceState } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { NotFoundError } from '../../common/errors';

export interface PresenceCounts {
  totalResidents: number;
  currentlyIn: number;
  currentlyOut: number;
}

export class PresenceService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async getResidentPresence(residentId: string) {
    const presence = await this.db.residentPresence.findUnique({
      where: { residentId },
      include: {
        resident: {
          select: {
            id: true,
            residentCode: true,
            fullName: true,
            roomGroup: true,
            status: true,
          },
        },
        lastMovementEvent: true,
      },
    });

    if (!presence) {
      throw new NotFoundError('ResidentPresence', residentId);
    }

    return presence;
  }

  public async getHostelPresenceCounts(hostelId: string): Promise<PresenceCounts> {
    const [currentlyIn, currentlyOut, totalResidents] = await Promise.all([
      this.db.residentPresence.count({
        where: {
          hostelId,
          currentState: PresenceState.IN,
          resident: { status: 'ACTIVE' },
        },
      }),
      this.db.residentPresence.count({
        where: {
          hostelId,
          currentState: PresenceState.OUT,
          resident: { status: 'ACTIVE' },
        },
      }),
      this.db.resident.count({
        where: {
          hostelId,
          status: 'ACTIVE',
        },
      }),
    ]);

    return {
      totalResidents,
      currentlyIn,
      currentlyOut,
    };
  }

  public async listResidentsByPresence(hostelId: string, state: PresenceState) {
    return this.db.residentPresence.findMany({
      where: {
        hostelId,
        currentState: state,
      },
      include: {
        resident: true,
        lastMovementEvent: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
