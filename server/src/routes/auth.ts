import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

function jwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not configured')
  return s
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body as {
      email?: string
      password?: string
      name?: string
    }

    if (!email || !password || !name) {
      return res.status(400).json({ message: '请填写邮箱、密码和姓名' })
    }
    if (password.length < 8) {
      return res.status(400).json({ message: '密码至少 8 位' })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ message: '该邮箱已注册' })
    }

    const hashed = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
    })

    const token = jwt.sign({ userId: user.id }, jwtSecret(), {
      expiresIn: '7d',
    })

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    })
  } catch (err) {
    console.error('[register]', err)
    return res.status(500).json({ message: '注册失败，请稍后再试' })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string
      password?: string
    }

    if (!email || !password) {
      return res.status(400).json({ message: '请填写邮箱和密码' })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' })
    }

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) {
      return res.status(401).json({ message: '邮箱或密码错误' })
    }

    const token = jwt.sign({ userId: user.id }, jwtSecret(), {
      expiresIn: '7d',
    })

    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    })
  } catch (err) {
    console.error('[login]', err)
    return res.status(500).json({ message: '登录失败，请稍后再试' })
  }
})

export default router
