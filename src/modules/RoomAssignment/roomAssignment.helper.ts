import { PoolClient } from "pg";

export const updateRoomStatus = async (
  client: PoolClient,
  roomId: number
) => {
  // Count occupied beds
  const occupiedResult = await client.query(
    `
    SELECT COUNT(*)::int AS occupied
    FROM beds
    WHERE room_id = $1
      AND status = 'Occupied'
    `,
    [roomId]
  );

  // Count total beds
  const totalResult = await client.query(
    `
    SELECT COUNT(*)::int AS total
    FROM beds
    WHERE room_id = $1
    `,
    [roomId]
  );

  const occupied = occupiedResult.rows[0].occupied;
  const total = totalResult.rows[0].total;

  let status: "Available" | "Occupied";

  if (occupied === total && total > 0) {
    status = "Occupied";
  } else {
    status = "Available";
  }

  await client.query(
    `
    UPDATE rooms
    SET status = $1
    WHERE id = $2
    `,
    [status, roomId]
  );
};