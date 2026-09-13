import { supabase } from './supabase';
import { today } from './format';

/**
 * Marks one worker's salary for one month as Paid (stamped with today's date)
 * or back to Due. Shared by Team's payroll and the Attendance Register.
 */
export async function setSalaryStatus(employeeId, month, status) {
  const { data, error } = await supabase.from('salary_payments')
    .upsert(
      {
        employee_id: employeeId,
        month,
        status,
        paid_on: status === 'Paid' ? today() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,month' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}
