// Neural network background — shared script for the standalone auth pages
// (login, signup, forgot-password, reset-password, verify-email, credits-success).
// The main app at index.html has this same animation inline (around line 2465 + 3468);
// keeping them in sync visually requires keeping the constants in this file matched.
//
// Self-contained: injects its own <style>, its own <canvas>, and runs.
// Just include `<script defer src="neural-bg.js"></script>` in any page.
(function () {
    if (document.getElementById('neural-canvas')) return; // idempotent

    const style = document.createElement('style');
    style.textContent = `
        #neural-canvas {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1;
        }
    `;
    document.head.appendChild(style);

    const canvas = document.createElement('canvas');
    canvas.id = 'neural-canvas';
    // Insert as first child of body so it sits behind other content; CSS z-index
    // still wins for layering but DOM order helps stacking with siblings that
    // don't set z-index.
    if (document.body.firstChild) {
        document.body.insertBefore(canvas, document.body.firstChild);
    } else {
        document.body.appendChild(canvas);
    }

    const ctx = canvas.getContext('2d');
    let nodes = [];

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        initNodes();
    }

    function initNodes() {
        nodes = [];
        const numNodes = 30;
        for (let i = 0; i < numNodes; i++) {
            nodes.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 2 + 1,
                pulse: Math.random() * Math.PI * 2,
                type: Math.random() > 0.8 ? 'active' : 'normal'
            });
        }
    }

    function drawNeuralNetwork() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 200) {
                    const opacity = (1 - dist / 200) * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(255, 80, 80, ${opacity})`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }

        nodes.forEach(node => {
            node.pulse += 0.02;
            const pulseSize = Math.sin(node.pulse) * 0.5 + 1;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius * pulseSize, 0, Math.PI * 2);

            if (node.type === 'active') {
                ctx.fillStyle = 'rgba(255, 80, 80, 0.6)';
            } else {
                ctx.fillStyle = 'rgba(100, 150, 255, 0.4)';
            }

            ctx.fill();

            node.x += node.vx;
            node.y += node.vy;

            if (node.x < 0 || node.x > canvas.width) node.vx *= -1;
            if (node.y < 0 || node.y > canvas.height) node.vy *= -1;
        });

        requestAnimationFrame(drawNeuralNetwork);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    drawNeuralNetwork();
})();
