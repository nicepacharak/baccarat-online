async function fetchUsers() {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) {
            window.location.href = '/'; // Redirect if not admin
            return;
        }
        const users = await response.json();
        const tableBody = document.getElementById('user-table-body');
        tableBody.innerHTML = '';

        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.balance.toFixed(2)}</td>
                <td>${user.role}</td>
                <td><input type="number" class="balance-input" step="100" placeholder="New balance"></td>
                <td><button class="update-btn" data-userid="${user.id}">Update</button></td>
            `;
            tableBody.appendChild(row);
        });
        attachUpdateListeners();
    } catch (err) {
        console.error('Failed to fetch users:', err);
    }
}

function attachUpdateListeners() {
    document.querySelectorAll('.update-btn').forEach(button => {
        button.addEventListener('click', async (e) => {
            const userId = e.target.dataset.userid;
            const newBalanceInput = e.target.closest('tr').querySelector('.balance-input');
            const newBalance = parseFloat(newBalanceInput.value);

            if (isNaN(newBalance) || newBalance < 0) {
                alert('Please enter a valid balance.');
                return;
            }

            try {
                const response = await fetch('/api/update-balance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, newBalance })
                });

                if (response.ok) {
                    alert('Balance updated successfully!');
                    fetchUsers(); // Refresh table
                } else {
                    alert('Failed to update balance.');
                }
            } catch (err) {
                console.error('Error updating balance:', err);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', fetchUsers);