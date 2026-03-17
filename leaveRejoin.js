function randomMs(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
}

function setupLeaveRejoin(bot, createBot) {
    let jumpTimer = null
    let jumpOffTimer = null

    let stopped = false

    function cleanup() {
        stopped = true
        if (jumpTimer) clearTimeout(jumpTimer)
        if (jumpOffTimer) clearTimeout(jumpOffTimer)
        jumpTimer = jumpOffTimer = null
    }

    function scheduleNextJump() {
        if (stopped || !bot.entity) return

        bot.setControlState('jump', true)
        jumpOffTimer = setTimeout(() => {
            if (bot) bot.setControlState('jump', false)
        }, 300)

        const nextJump = randomMs(20000, 5 * 60 * 1000)
        jumpTimer = setTimeout(scheduleNextJump, nextJump)
    }

    bot.once('spawn', () => {
        stopped = false
        cleanup()
        stopped = false

        console.log('[AFK] Bot spawned - staying connected until kicked/disconnected')
        scheduleNextJump()
    })

    bot.on('end', () => { cleanup() })
    bot.on('kicked', () => { cleanup() })
    bot.on('error', () => { cleanup() })
}

module.exports = setupLeaveRejoin
