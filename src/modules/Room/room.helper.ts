
import { PoolClient } from "pg";


export const refreshRoomStatus = async (
  client: PoolClient,
  roomId: number
) => {

  const roomResult = await client.query(
    `
    SELECT
        capacity,
        status
    FROM rooms
    WHERE id = $1
    `,
    [roomId]
  );

  if (roomResult.rowCount === 0) return;

  // Don't overwrite maintenance
  if (roomResult.rows[0].status === "Under Maintenance") {
    return;
  }

  const occupiedResult = await client.query(
    `
    SELECT COUNT(*) AS occupied
    FROM room_assignments
    WHERE
        room_id = $1
    AND
        status = 'Active'
    `,
    [roomId]
  );

  const occupied = Number(
    occupiedResult.rows[0].occupied
  );

  const capacity = Number(
    roomResult.rows[0].capacity
  );

  const status =
    occupied >= capacity
      ? "Occupied"
      : "Available";

  await client.query(
    `
    UPDATE rooms
    SET status = $1
    WHERE id = $2
    `,
    [status, roomId]
  );
};